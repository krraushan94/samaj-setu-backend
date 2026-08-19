const { randomUUID: uuidv4, randomBytes } = require('crypto');
const { query } = require('../../config/db');
const { CATEGORY_DEPARTMENT_MAP, PAYMENT_EXEMPT_GROUPS, PAYMENT_EXEMPT_SUBCATEGORY_LABELS } = require('../../config/constants');
const { asyncHandler } = require('../../middleware/errorHandler');
const { needsModerationReview } = require('../../utils/moderation');
const { notifyCitizen, notifyTeamMember, notifyDepartment } = require('../../utils/notify');

// Generate ticket number: SJT-2026-XXXXX — uses a CSPRNG rather than Math.random() since
// this identifier ends up in citizen-facing tracking references.
const genTicketNumber = () => `SJT-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase().slice(0, 5)}`;

// Auto-determine priority based on category group + submitter gender.
// `category` is the top-level group key (e.g. 'women_safety'); `subCategory` is the
// human-readable sub-category label the app sends (e.g. 'Missing Child', 'Epidemic Alert') —
// matched here rather than against machine slugs, since that's the actual shape of the data.
const autoPriority = (category, subCategory, gender, requestedPriority) => {
  if (category === 'women_safety' && gender === 'female') return 'critical';
  if (subCategory === 'Missing Child') return 'critical';
  if (subCategory === 'Epidemic Alert') return 'critical';
  if (subCategory === 'Mental Health Crisis') return 'critical';
  if (subCategory === 'Elder Abuse / Neglect' || subCategory === 'Caste-Based Discrimination') {
    return requestedPriority === 'critical' ? 'critical' : 'high';
  }
  // Severe/vulnerable labour matters (bonded labour, child labour, workplace abuse) get the
  // same treatment — they're the same PAYMENT_EXEMPT_SUBCATEGORY_LABELS list minus the three
  // already handled above.
  if (PAYMENT_EXEMPT_SUBCATEGORY_LABELS.includes(subCategory)) {
    return requestedPriority === 'critical' ? 'critical' : 'high';
  }
  return requestedPriority || 'medium';
};

// BMS/labour tickets carry worker-identity context no other category needs — checked here
// (not just client-side) since the client can't be trusted to enforce a required field.
const validateLabourDetails = (labourDetails) => {
  const d = labourDetails || {};
  if (!d.fullName?.trim()) return 'Worker\'s full name is required';
  if (!d.organisationName?.trim()) return 'Organisation / employer name is required';
  if (!d.aadharNumber?.trim() && !d.voterIdNumber?.trim()) return 'Aadhaar number or Voter ID is required';
  if (d.aadharNumber?.trim() && !/^\d{12}$/.test(d.aadharNumber.trim())) return 'Aadhaar number must be exactly 12 digits';
  if (d.voterIdNumber?.trim() && !/^[A-Za-z]{3}[0-9]{7}$/.test(d.voterIdNumber.trim())) return 'Enter a valid Voter ID (EPIC) number';
  return null;
};

// Create a new ticket (citizen)
const createTicket = asyncHandler(async (req, res) => {
  const { category, subCategory, title, description, latitude, longitude, locationText, priority, isAnonymous, labourDetails } = req.body;
  const userId = req.user.id;

  if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
  if (!locationText?.trim()) return res.status(400).json({ success: false, message: 'Location is required' });

  let labourDetailsJson = null;
  if (category === 'labour') {
    const labourError = validateLabourDetails(labourDetails);
    if (labourError) return res.status(400).json({ success: false, message: labourError });
    // Only persist the known fields — never store arbitrary client-supplied keys as-is.
    labourDetailsJson = JSON.stringify({
      fullName: labourDetails.fullName.trim(),
      organisationName: labourDetails.organisationName.trim(),
      aadharNumber: labourDetails.aadharNumber?.trim() || null,
      voterIdNumber: labourDetails.voterIdNumber?.trim() || null,
      idCardNumber: labourDetails.idCardNumber?.trim() || null,
      sector: labourDetails.sector?.trim() || null,
      monthlyWage: labourDetails.monthlyWage?.trim() || null,
      employmentDuration: labourDetails.employmentDuration?.trim() || null,
      employerContact: labourDetails.employerContact?.trim() || null,
      isBmsMember: !!labourDetails.isBmsMember,
      bmsMembershipNumber: labourDetails.bmsMembershipNumber?.trim() || null,
    });
  }

  // Fetch user gender for auto-priority
  const userResult = await query('SELECT gender FROM users WHERE id=$1', [userId]);
  const gender = userResult.rows[0]?.gender?.toLowerCase();

  const finalPriority = autoPriority(category, subCategory, gender, priority);

  // Route to department
  const deptResult = await query('SELECT id FROM departments WHERE name=$1', [CATEGORY_DEPARTMENT_MAP[category] || 'Others']);
  const departmentId = deptResult.rows[0]?.id || null;

  // Infrastructure, women-safety and missing/emergency categories are fee-exempt — a citizen
  // should never have to pay to report a public-good issue or a safety emergency. A few
  // individual sub-categories (elder abuse, caste discrimination, mental health crisis) are
  // exempt too even though their group is normally paid.
  const paymentRequired = !PAYMENT_EXEMPT_GROUPS.includes(category) && !PAYMENT_EXEMPT_SUBCATEGORY_LABELS.includes(subCategory);
  const initialStatus = paymentRequired ? 'payment_pending' : 'open';

  const ticketId = uuidv4();
  const ticketNumber = genTicketNumber();
  const flaggedForReview = await needsModerationReview(`${title || ''} ${description || ''}`);

  await query(
    `INSERT INTO tickets (id, ticket_number, user_id, category, sub_category, title, description,
      latitude, longitude, location_text, priority, status, department_id, is_anonymous, needs_review, labour_details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [ticketId, ticketNumber, userId, category, subCategory, title, description,
     latitude || null, longitude || null, locationText || null, finalPriority, initialStatus, departmentId, isAnonymous || false, flaggedForReview, labourDetailsJson]
  );

  // Audit log
  await query(
    'INSERT INTO audit_logs (id, actor_id, actor_role, action, entity, entity_id, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), userId, 'citizen', 'ticket_created', 'tickets', ticketId, req.ip]
  );

  res.status(201).json({ success: true, ticketId, ticketNumber, priority: finalPriority, status: initialStatus, paymentRequired });
});

// List tickets — role-based filtering.
// Team leaders/members see tickets across ALL departments (so the team has visibility into
// what's happening elsewhere), but only their own department is actionable — `canManage` tells
// the client whether to show action buttons for a given row. Cross-department edits are still
// blocked server-side in updateStatus/addNote regardless of what the client does with this flag.
const listTickets = asyncHandler(async (req, res) => {
  const { status, priority, category, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (req.user.role === 'citizen') {
    conditions.push(`t.user_id = $${params.push(req.user.id)}`);
  }
  // leader / member / admin all see every ticket — canManage distinguishes own-department

  if (status) conditions.push(`t.status = $${params.push(status)}`);
  if (priority) conditions.push(`t.priority = $${params.push(priority)}`);
  if (category) conditions.push(`t.category = $${params.push(category)}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT t.*, u.full_name, u.mobile, u.ward, d.name AS department_name
     FROM tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN departments d ON t.department_id = d.id
     ${where}
     ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
              t.created_at DESC
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params
  );

  const isTeamRole = req.user.role === 'leader' || req.user.role === 'member';
  const tickets = result.rows.map((t) => ({
    ...t,
    canManage: req.user.role === 'admin' ? true : isTeamRole ? t.department_id === req.user.departmentId : false,
  }));

  res.json({ success: true, tickets, page: +page, limit: +limit });
});

// Get single ticket
const getTicket = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT t.*, u.full_name, u.mobile, u.gender, u.ward, u.caregiver_name, u.caregiver_mobile, d.name AS department_name,
            json_agg(DISTINCT ma.*) FILTER (WHERE ma.id IS NOT NULL) AS media,
            json_agg(DISTINCT th.*) FILTER (WHERE th.id IS NOT NULL) AS history
     FROM tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN departments d ON t.department_id = d.id
     LEFT JOIN media_attachments ma ON ma.ticket_id = t.id
     LEFT JOIN ticket_history th ON th.ticket_id = t.id
     WHERE t.id = $1
     GROUP BY t.id, u.full_name, u.mobile, u.gender, u.ward, u.caregiver_name, u.caregiver_mobile, d.name`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });

  const ticket = result.rows[0];

  // A citizen may only view their own ticket — otherwise any logged-in citizen could
  // enumerate ticket IDs and read someone else's report, including sensitive categories
  // (women-safety, missing-child, abuse) that the app deliberately keeps private elsewhere.
  // Team/admin cross-department read visibility is intentional (see listTickets above) and
  // untouched here — only the citizen case was ever unscoped.
  if (req.user.role === 'citizen' && ticket.user_id !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  // Mask mobile/caregiver contact for citizens — only team/admin need it to reach a caregiver
  if (req.user.role === 'citizen') { delete ticket.mobile; delete ticket.caregiver_name; delete ticket.caregiver_mobile; }

  const isTeamRole = req.user.role === 'leader' || req.user.role === 'member';
  ticket.canManage = req.user.role === 'admin' ? true : isTeamRole ? ticket.department_id === req.user.departmentId : false;

  res.json({ success: true, ticket });
});

// Update status (team / admin)
const updateStatus = asyncHandler(async (req, res) => {
  const { status, note, resolutionPhoto } = req.body;
  const { id } = req.params;

  const current = await query('SELECT status, department_id, user_id, ticket_number FROM tickets WHERE id=$1', [id]);
  if (!current.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Team leaders can only update tickets in their department
  if (req.user.role === 'leader' && current.rows[0].department_id !== req.user.departmentId) {
    return res.status(403).json({ success: false, message: 'Not your department' });
  }

  await query(
    'UPDATE tickets SET status=$1, resolution_note=$2, resolution_photo=$3, updated_at=NOW() WHERE id=$4',
    [status, note || null, resolutionPhoto || null, id]
  );
  await query(
    'INSERT INTO ticket_history (id, ticket_id, changed_by, role, old_status, new_status, note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), id, req.user.username || req.user.id, req.user.role, current.rows[0].status, status, note || null]
  );
  await notifyCitizen(
    current.rows[0].user_id,
    `Ticket ${current.rows[0].ticket_number} updated`,
    `Your ticket status is now "${status}".${note ? ` Note: ${note}` : ''}`,
    'ticket_status',
    { entityType: 'ticket', entityId: id },
  );
  res.json({ success: true, message: 'Status updated' });
});

// Upvote (Me Too)
const upvoteTicket = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await query('INSERT INTO ticket_upvotes (user_id, ticket_id) VALUES ($1,$2)', [userId, id]);
    const result = await query(
      'UPDATE tickets SET upvote_count = upvote_count + 1 WHERE id=$1 RETURNING upvote_count',
      [id]
    );
    const count = result.rows[0].upvote_count;
    // Auto-escalate if threshold reached
    if (count >= 5) await query("UPDATE tickets SET priority='high' WHERE id=$1 AND priority IN ('low','medium')", [id]);
    res.json({ success: true, upvoteCount: count });
  } catch {
    res.status(409).json({ success: false, message: 'Already upvoted' });
  }
});

// Citizen rates resolved ticket
const rateTicket = asyncHandler(async (req, res) => {
  const { rating, feedback } = req.body;
  if (rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be 1–5' });
  await query(
    'UPDATE tickets SET citizen_rating=$1, citizen_feedback=$2 WHERE id=$3 AND user_id=$4',
    [rating, feedback || null, req.params.id, req.user.id]
  );
  res.json({ success: true, message: 'Thank you for your feedback' });
});

// Assign ticket to team member
const assignTicket = asyncHandler(async (req, res) => {
  const { assignedTo, departmentId } = req.body;
  const { id } = req.params;

  const current = await query('SELECT department_id, ticket_number FROM tickets WHERE id=$1', [id]);
  if (!current.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });

  // Team leaders can only assign within their own department, and can't move a ticket
  // to a different department (only admin can re-route)
  if (req.user.role === 'leader') {
    if (current.rows[0].department_id !== req.user.departmentId) {
      return res.status(403).json({ success: false, message: 'Not your department' });
    }
    if (departmentId && departmentId !== req.user.departmentId) {
      return res.status(403).json({ success: false, message: 'Only admin can move a ticket to another department' });
    }
  }

  await query(
    'UPDATE tickets SET assigned_to=$1, department_id=COALESCE($2, department_id), updated_at=NOW() WHERE id=$3',
    [assignedTo || null, departmentId || null, id]
  );
  if (assignedTo) {
    await notifyTeamMember(assignedTo, 'New ticket assigned', `Ticket ${current.rows[0].ticket_number} has been assigned to you.`, 'ticket_assigned', { entityType: 'ticket', entityId: id });
  }
  res.json({ success: true, message: 'Ticket assigned' });
});

// Add internal note
const addNote = asyncHandler(async (req, res) => {
  const { note } = req.body;
  const { id } = req.params;

  if (req.user.role === 'leader') {
    const current = await query('SELECT department_id FROM tickets WHERE id=$1', [id]);
    if (!current.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    if (current.rows[0].department_id !== req.user.departmentId) {
      return res.status(403).json({ success: false, message: 'Not your department' });
    }
  }

  await query(
    'INSERT INTO ticket_history (id, ticket_id, changed_by, role, note) VALUES ($1,$2,$3,$4,$5)',
    [uuidv4(), id, req.user.username || req.user.id, req.user.role, note]
  );
  res.json({ success: true, message: 'Note added' });
});

// SOS — creates a critical ticket automatically
const sosTicket = asyncHandler(async (req, res) => {
  const { latitude, longitude, locationText } = req.body;
  const userId = req.user.id;
  const userResult = await query('SELECT full_name, gender FROM users WHERE id=$1', [userId]);
  const user = userResult.rows[0];

  const deptResult = await query("SELECT id FROM departments WHERE name='Social Welfare'");
  const departmentId = deptResult.rows[0]?.id;

  const ticketId = uuidv4();
  const ticketNumber = genTicketNumber();

  await query(
    `INSERT INTO tickets (id, ticket_number, user_id, category, sub_category, title, description,
      latitude, longitude, location_text, priority, status, department_id)
     VALUES ($1,$2,$3,'women_safety','Unsafe Area','🚨 SOS EMERGENCY','Emergency SOS triggered',$4,$5,$6,'critical','open',$7)`,
    [ticketId, ticketNumber, userId, latitude || null, longitude || null, locationText || 'Location not provided', departmentId]
  );

  // Audit log — same pattern as createTicket, so SOS triggers are traceable too
  await query(
    'INSERT INTO audit_logs (id, actor_id, actor_role, action, entity, entity_id, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), userId, 'citizen', 'sos_triggered', 'tickets', ticketId, req.ip]
  );

  await notifyDepartment(
    departmentId,
    '🚨 SOS Emergency',
    `${user?.full_name || 'A citizen'} triggered an SOS at ${locationText || 'an unknown location'}. Ticket ${ticketNumber}.`,
    'sos',
    { entityType: 'ticket', entityId: ticketId },
  );

  res.status(201).json({ success: true, ticketId, ticketNumber, message: 'SOS alert sent — the Social Welfare team has been notified. Help is on the way.' });
});

module.exports = { createTicket, listTickets, getTicket, updateStatus, upvoteTicket, rateTicket, assignTicket, addNote, sosTicket };
