const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const { randomUUID: uuidv4 } = require('crypto');
const { NEVER_PUBLIC_GROUPS, NEVER_PUBLIC_SUBCATEGORY_LABELS } = require('../../config/constants');

const router = Router();

// Public community board (no auth required)
router.get('/board', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, category, ward } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [
    "(t.is_anonymous = FALSE OR t.is_anonymous IS NULL)",
    "t.status != 'payment_pending'",
    "t.is_hidden_from_board = FALSE",
    // Women-safety and other personal-safety categories never appear publicly, regardless of
    // the anonymity flag — this stays strictly citizen ↔ team ↔ admin.
    `t.category NOT IN (${NEVER_PUBLIC_GROUPS.map((_, i) => `$${i + 1}`).join(',')})`,
    `t.sub_category NOT IN (${NEVER_PUBLIC_SUBCATEGORY_LABELS.map((_, i) => `$${NEVER_PUBLIC_GROUPS.length + i + 1}`).join(',')})`,
  ];
  const params = [...NEVER_PUBLIC_GROUPS, ...NEVER_PUBLIC_SUBCATEGORY_LABELS];

  if (status) conditions.push(`t.status = $${params.push(status)}`);
  if (category) conditions.push(`t.category = $${params.push(category)}`);
  if (ward) conditions.push(`u.ward = $${params.push(ward)}`);

  const result = await query(
    `SELECT t.id, t.ticket_number, t.category, t.sub_category, t.title, t.status,
            t.priority, t.upvote_count, t.created_at, t.location_text,
            CASE WHEN t.is_anonymous THEN 'A resident' ELSE CONCAT('Resident of Ward ', u.ward) END AS submitter,
            d.name AS department
     FROM tickets t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN departments d ON t.department_id = d.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.created_at DESC
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params
  );
  res.json({ success: true, issues: result.rows });
}));

// Report a board post as false / defamatory / inappropriate (any signed-in citizen)
router.post('/board/:ticketId/report', verifyToken, asyncHandler(async (req, res) => {
  const { reason } = req.body;
  await query(
    'INSERT INTO post_reports (id, ticket_id, reporter_user_id, reason) VALUES ($1,$2,$3,$4)',
    [uuidv4(), req.params.ticketId, req.user.id, reason || null]
  );
  res.status(201).json({ success: true, message: 'Thanks — our team will review this post.' });
}));

// Admin: list reported posts, and hide/unhide a post from the public board
router.get('/board/reports', verifyToken, requireAdmin, asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT t.id AS ticket_id, t.ticket_number, t.title, t.category, t.sub_category, t.is_hidden_from_board,
            COUNT(pr.id) AS report_count, MAX(pr.created_at) AS last_reported_at
     FROM post_reports pr
     JOIN tickets t ON t.id = pr.ticket_id
     GROUP BY t.id, t.ticket_number, t.title, t.category, t.sub_category, t.is_hidden_from_board
     ORDER BY last_reported_at DESC`
  );
  res.json({ success: true, reports: result.rows });
}));

router.patch('/board/:ticketId/hide', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { hidden = true } = req.body;
  await query('UPDATE tickets SET is_hidden_from_board=$1, updated_at=NOW() WHERE id=$2', [hidden, req.params.ticketId]);
  res.json({ success: true, message: hidden ? 'Post hidden from public board' : 'Post restored to public board' });
}));

// Events
router.get('/events', asyncHandler(async (_req, res) => {
  const result = await query('SELECT * FROM events ORDER BY event_date ASC');
  res.json({ success: true, events: result.rows });
}));

router.post('/events', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, description, eventDate, location } = req.body;
  await query(
    'INSERT INTO events (id, title, description, event_date, location, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), title, description, eventDate, location, 'Admin_Raushan']
  );
  res.status(201).json({ success: true, message: 'Event created' });
}));

// Missing persons
router.get('/missing', asyncHandler(async (_req, res) => {
  const result = await query("SELECT * FROM missing_persons WHERE status='active' ORDER BY created_at DESC");
  res.json({ success: true, persons: result.rows });
}));

router.post('/missing', verifyToken, asyncHandler(async (req, res) => {
  const { name, age, gender, photoUrl, lastSeen, description, contact } = req.body;
  const id = uuidv4();
  await query(
    'INSERT INTO missing_persons (id, reported_by, name, age, gender, photo_url, last_seen, description, contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, req.user.id, name, age, gender, photoUrl, lastSeen, description, contact]
  );
  res.status(201).json({ success: true, id, message: 'Missing person reported' });
}));

module.exports = router;
