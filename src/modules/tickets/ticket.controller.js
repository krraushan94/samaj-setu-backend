const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { WOMEN_SAFETY_CATEGORIES, CATEGORY_DEPARTMENT_MAP } = require('../../config/constants');
const { asyncHandler } = require('../../middleware/errorHandler');

// Generate ticket number: SJT-2026-XXXXX
const genTicketNumber = () => `SJT-${new Date().getFullYear()}-${Math.random().toString(36).toUpperCase().slice(2, 7)}`;

// Auto-determine priority based on category + submitter gender
const autoPriority = (category, gender, requestedPriority) => {
  if (WOMEN_SAFETY_CATEGORIES.includes(category) && gender === 'female') return 'critical';
  if (category === 'missing_child') return 'critical';
  if (category === 'epidemic_alert') return 'critical';
  return requestedPriority || 'medium';
};

// Create a new ticket (citizen)
const createTicket = asyncHandler(async (req, res) => {
  const { category, subCategory, title, description, latitude, longitude, locationText, priority, isAnonymous } = req.body;
  const userId = req.user.id;

  // Fetch user gender for auto-priority
  const userResult = await query('SELECT gender FROM users WHERE id=$1', [userId]);
  const gender = userResult.rows[0]?.gender?.toLowerCase();

  const finalPriority = autoPriority(subCategory || category, gender, priority);

  // Route to department
  const deptResult = await query('SELECT id FROM departments WHERE name=$1', [CATEGORY_DEPARTMENT_MAP[category] || 'Others']);
  const departmentId = deptResult.rows[0]?.id || null;

  const ticketId = uuidv4();
  const ticketNumber = genTicketNumber();

  await query(
    `INSERT INTO tickets (id, ticket_number, user_id, category, sub_category, title, description,
      latitude, longitude, location_text, priority, status, department_id, is_anonymous)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'payment_pending',$12,$13)`,
    [ticketId, ticketNumber, userId, category, subCategory, title, description,
     latitude || null, longitude || null, locationText || null, finalPriority, departmentId, isAnonymous || false]
  );

  // Audit log
  await query(
    'INSERT INTO audit_logs (id, actor_id, actor_role, action, entity, entity_id, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), userId, 'citizen', 'ticket_created', 'tickets', ticketId, req.ip]
  );

  res.status(201).json({ success: true, ticketId, ticketNumber, priority: finalPriority, status: 'payment_pending' });
});

// List tickets — role-based filtering
const listTickets = asyncHandler(async (req, res) => {
  const { status, priority, category, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (req.user.role === 'citizen') {
    conditions.push(`t.user_id = $${params.push(req.user.id)}`);
  } else if (req.user.role === 'leader') {
    conditions.push(`t.department_id = $${params.push(req.user.departmentId)}`);
  }
  // admin sees all

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
  res.json({ success: true, tickets: result.rows, page: +page, limit: +limit });
});

// Get single ticket
const getTicket = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT t.*, u.full_name, u.mobile, u.gender, u.ward, d.name AS department_name,
            json_agg(DISTINCT ma.*) FILTER (WHERE ma.id IS NOT NULL) AS media,
            json_agg(DISTINCT th.*) FILTER (WHERE th.id IS NOT NULL) AS history
     FROM tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN departments d ON t.department_id = d.id
     LEFT JOIN media_attachments ma ON ma.ticket_id = t.id
     LEFT JOIN ticket_history th ON th.ticket_id = t.id
     WHERE t.id = $1
     GROUP BY t.id, u.full_name, u.mobile, u.gender, u.ward, d.name`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });

  const ticket = result.rows[0];
  // Mask mobile for non-admin, non-leader
  if (req.user.role === 'citizen') delete ticket.mobile;

  res.json({ success: true, ticket });
});

// Update status (team / admin)
const updateStatus = asyncHandler(async (req, res) => {
  const { status, note, resolutionPhoto } = req.body;
  const { id } = req.params;

  const current = await query('SELECT status, department_id FROM tickets WHERE id=$1', [id]);
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
  await query(
    'UPDATE tickets SET assigned_to=$1, department_id=COALESCE($2, department_id), updated_at=NOW() WHERE id=$3',
    [assignedTo || null, departmentId || null, req.params.id]
  );
  res.json({ success: true, message: 'Ticket assigned' });
});

// Add internal note
const addNote = asyncHandler(async (req, res) => {
  const { note } = req.body;
  await query(
    'INSERT INTO ticket_history (id, ticket_id, changed_by, role, note) VALUES ($1,$2,$3,$4,$5)',
    [uuidv4(), req.params.id, req.user.username || req.user.id, req.user.role, note]
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
     VALUES ($1,$2,$3,'women_safety','unsafe_area','SOS EMERGENCY','Emergency SOS triggered',$4,$5,$6,'critical','open',$7)`,
    [ticketId, ticketNumber, userId, latitude || null, longitude || null, locationText || 'Location not provided', departmentId]
  );

  res.status(201).json({ success: true, ticketId, ticketNumber, message: 'SOS alert sent to Social Welfare team' });
});

module.exports = { createTicket, listTickets, getTicket, updateStatus, upvoteTicket, rateTicket, assignTicket, addNote, sosTicket };
