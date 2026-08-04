const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID: uuidv4 } = require('crypto');
const { verifyToken, requireAdmin, requireTeamLeader } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const { ADMIN_USERNAME } = require('../../config/constants');

const router = Router();

// ── Admin Profile ──────────────────────────────────────────────────────────────
router.get('/profile', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const result = await query('SELECT username, full_name, email, phone, last_login, created_at FROM admin_users WHERE username=$1', [req.user.username || ADMIN_USERNAME]);
  const profile = result.rows[0] || { username: ADMIN_USERNAME, email: 'sihsraushandc@gmail.com' };
  res.json({ success: true, profile });
}));

router.patch('/profile', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, email, phone } = req.body;
  await query(
    'UPDATE admin_users SET full_name=COALESCE($1,full_name), email=COALESCE($2,email), phone=COALESCE($3,phone), updated_at=NOW() WHERE username=$4',
    [fullName, email, phone, req.user.username || ADMIN_USERNAME]
  );
  res.json({ success: true, message: 'Profile updated' });
}));

// ── Change Password (self) ─────────────────────────────────────────────────────
router.patch('/change-password', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  const result = await query('SELECT password_hash FROM admin_users WHERE username=$1', [req.user.username || ADMIN_USERNAME]);
  if (result.rows.length) {
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Current password incorrect' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE username=$2', [hash, req.user.username || ADMIN_USERNAME]);
  res.json({ success: true, message: 'Password changed. Update ADMIN_PASSWORD_HASH in .env if applicable.' });
}));

// ── Sub-Admin Management (only Admin_Raushan) ──────────────────────────────────
router.get('/sub-admins', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  if (req.user.username !== ADMIN_USERNAME) return res.status(403).json({ success: false, message: 'Only Admin_Raushan can manage sub-admins' });
  const result = await query('SELECT id, username, full_name, email, phone, is_active, last_login, created_at FROM admin_users ORDER BY created_at');
  res.json({ success: true, admins: result.rows });
}));

router.post('/sub-admins', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  if (req.user.username !== ADMIN_USERNAME) return res.status(403).json({ success: false, message: 'Only Admin_Raushan can create admin accounts' });
  const { username, fullName, email, phone, password } = req.body;
  if (!username || !password || password.length < 8) return res.status(400).json({ success: false, message: 'Username and password (8+ chars) required' });
  const existing = await query('SELECT id FROM admin_users WHERE username=$1', [username]);
  if (existing.rows.length) return res.status(409).json({ success: false, message: 'Username already taken' });
  const hash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  await query(
    'INSERT INTO admin_users (id, username, full_name, email, phone, password_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, username, fullName || username, email || null, phone || null, hash, ADMIN_USERNAME]
  );
  res.status(201).json({ success: true, id, message: `Sub-admin "${username}" created` });
}));

router.patch('/sub-admins/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  if (req.user.username !== ADMIN_USERNAME) return res.status(403).json({ success: false, message: 'Only Admin_Raushan can modify admin accounts' });
  const { fullName, email, phone, isActive, newPassword } = req.body;
  if (newPassword) {
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
  }
  await query(
    'UPDATE admin_users SET full_name=COALESCE($1,full_name), email=COALESCE($2,email), phone=COALESCE($3,phone), is_active=COALESCE($4,is_active), updated_at=NOW() WHERE id=$5',
    [fullName, email, phone, isActive !== undefined ? isActive : null, req.params.id]
  );
  res.json({ success: true, message: 'Sub-admin updated' });
}));

router.delete('/sub-admins/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  if (req.user.username !== ADMIN_USERNAME) return res.status(403).json({ success: false, message: 'Only Admin_Raushan can delete admin accounts' });
  // Prevent deleting Admin_Raushan itself
  const target = await query('SELECT username FROM admin_users WHERE id=$1', [req.params.id]);
  if (target.rows[0]?.username === ADMIN_USERNAME) return res.status(403).json({ success: false, message: 'Cannot delete primary admin' });
  await query('DELETE FROM admin_users WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Sub-admin deleted' });
}));

// ── App Settings CRUD ──────────────────────────────────────────────────────────
router.get('/settings', verifyToken, requireAdmin, asyncHandler(async (_req, res) => {
  const result = await query('SELECT key, value, label, updated_by, updated_at FROM app_settings ORDER BY key');
  res.json({ success: true, settings: result.rows });
}));

router.patch('/settings/:key', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { value } = req.body;
  const username = req.user.username || ADMIN_USERNAME;
  await query(
    'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()',
    [req.params.key, value, username]
  );
  res.json({ success: true, message: `Setting "${req.params.key}" updated` });
}));

router.post('/settings', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { key, value, label } = req.body;
  if (!key) return res.status(400).json({ success: false, message: 'key required' });
  const username = req.user.username || ADMIN_USERNAME;
  await query(
    'INSERT INTO app_settings (key, value, label, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO UPDATE SET value=$2',
    [key, value, label || key, username]
  );
  res.status(201).json({ success: true, message: 'Setting created' });
}));

router.delete('/settings/:key', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM app_settings WHERE key=$1', [req.params.key]);
  res.json({ success: true, message: 'Setting deleted' });
}));

// ── Issue Categories CRUD ──────────────────────────────────────────────────────
router.get('/categories', asyncHandler(async (_req, res) => {
  const cats = await query('SELECT * FROM issue_categories ORDER BY sort_order, label');
  const subs = await query('SELECT * FROM issue_sub_categories ORDER BY sort_order, label');
  const result = cats.rows.map(c => ({ ...c, sub_categories: subs.rows.filter(s => s.category_key === c.key) }));
  res.json({ success: true, categories: result });
}));

router.post('/categories', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { key, label, icon, color, department, sortOrder } = req.body;
  if (!key || !label) return res.status(400).json({ success: false, message: 'key and label required' });
  const id = uuidv4();
  await query(
    'INSERT INTO issue_categories (id, key, label, icon, color, department, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, key, label, icon || 'help', color || '#9E9E9E', department || 'Others', sortOrder || 100]
  );
  res.status(201).json({ success: true, id, message: 'Category created' });
}));

router.patch('/categories/:key', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { label, icon, color, department, isActive, sortOrder } = req.body;
  await query(
    'UPDATE issue_categories SET label=COALESCE($1,label), icon=COALESCE($2,icon), color=COALESCE($3,color), department=COALESCE($4,department), is_active=COALESCE($5,is_active), sort_order=COALESCE($6,sort_order), updated_at=NOW() WHERE key=$7',
    [label, icon, color, department, isActive !== undefined ? isActive : null, sortOrder, req.params.key]
  );
  res.json({ success: true, message: 'Category updated' });
}));

router.delete('/categories/:key', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('UPDATE issue_categories SET is_active=FALSE, updated_at=NOW() WHERE key=$1', [req.params.key]);
  res.json({ success: true, message: 'Category deactivated' });
}));

// Sub-category CRUD
router.post('/categories/:key/sub', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { label, sortOrder } = req.body;
  const id = uuidv4();
  await query('INSERT INTO issue_sub_categories (id, category_key, label, sort_order) VALUES ($1,$2,$3,$4)', [id, req.params.key, label, sortOrder || 100]);
  res.status(201).json({ success: true, id, message: 'Sub-category added' });
}));

router.patch('/categories/sub/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { label, isActive, sortOrder } = req.body;
  await query('UPDATE issue_sub_categories SET label=COALESCE($1,label), is_active=COALESCE($2,is_active), sort_order=COALESCE($3,sort_order) WHERE id=$4',
    [label, isActive !== undefined ? isActive : null, sortOrder, req.params.id]);
  res.json({ success: true, message: 'Sub-category updated' });
}));

router.delete('/categories/sub/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('UPDATE issue_sub_categories SET is_active=FALSE WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Sub-category deactivated' });
}));

// ── Ticket Admin CRUD ──────────────────────────────────────────────────────────
router.get('/tickets', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, status, priority, dept, ward, search, dateFrom, dateTo } = req.query;
  const offset = (page - 1) * limit;
  const conditions = []; const params = [];
  if (status)   conditions.push(`t.status=$${params.push(status)}`);
  if (priority) conditions.push(`t.priority=$${params.push(priority)}`);
  if (dept)     conditions.push(`d.name ILIKE $${params.push(`%${dept}%`)}`);
  if (ward)     conditions.push(`u.ward=$${params.push(ward)}`);
  if (search)   conditions.push(`(t.title ILIKE $${params.push(`%${search}%`)} OR t.ticket_number ILIKE $${params.push(`%${search}%`)})`);
  if (dateFrom) conditions.push(`t.created_at >= $${params.push(dateFrom)}`);
  if (dateTo)   conditions.push(`t.created_at <= $${params.push(dateTo)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [data, count] = await Promise.all([
    query(`SELECT t.*, u.full_name, u.mobile, u.gender, u.ward, d.name AS department_name FROM tickets t LEFT JOIN users u ON t.user_id=u.id LEFT JOIN departments d ON t.department_id=d.id ${where} ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.created_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`, params),
    query(`SELECT COUNT(*) FROM tickets t LEFT JOIN users u ON t.user_id=u.id LEFT JOIN departments d ON t.department_id=d.id ${where}`, params.slice(0, -2)),
  ]);
  res.json({ success: true, tickets: data.rows, total: +count.rows[0].count, page: +page, limit: +limit });
}));

router.patch('/tickets/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, description, category, subCategory, priority, status, departmentId, assignedTo, locationText } = req.body;
  await query(
    `UPDATE tickets SET title=COALESCE($1,title), description=COALESCE($2,description), category=COALESCE($3,category), sub_category=COALESCE($4,sub_category), priority=COALESCE($5,priority), status=COALESCE($6,status), department_id=COALESCE($7,department_id), assigned_to=COALESCE($8,assigned_to), location_text=COALESCE($9,location_text), updated_at=NOW() WHERE id=$10`,
    [title, description, category, subCategory, priority, status, departmentId, assignedTo, locationText, req.params.id]
  );
  // Log admin action
  await query('INSERT INTO audit_logs (id,actor_id,actor_role,action,entity,entity_id,ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), req.user.username || 'admin', 'admin', 'ticket_edited', 'tickets', req.params.id, req.ip]);
  res.json({ success: true, message: 'Ticket updated by admin' });
}));

router.delete('/tickets/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  // Soft delete — mark as closed with admin note
  await query("UPDATE tickets SET status='closed', resolution_note='Removed by admin', updated_at=NOW() WHERE id=$1", [req.params.id]);
  await query('INSERT INTO audit_logs (id,actor_id,actor_role,action,entity,entity_id,ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uuidv4(), req.user.username || 'admin', 'admin', 'ticket_closed_by_admin', 'tickets', req.params.id, req.ip]);
  res.json({ success: true, message: 'Ticket closed by admin' });
}));

// ── User Admin CRUD ────────────────────────────────────────────────────────────
router.patch('/users/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, email, mobile, gender, pincode, mandal, ward, colony, isVerified, isBlocked } = req.body;
  await query(
    'UPDATE users SET full_name=COALESCE($1,full_name), email=COALESCE($2,email), gender=COALESCE($3,gender), pincode=COALESCE($4,pincode), mandal=COALESCE($5,mandal), ward=COALESCE($6,ward), colony=COALESCE($7,colony), is_verified=COALESCE($8,is_verified), is_blocked=COALESCE($9,is_blocked), updated_at=NOW() WHERE id=$10',
    [fullName, email, gender, pincode, mandal, ward, colony, isVerified !== undefined ? isVerified : null, isBlocked !== undefined ? isBlocked : null, req.params.id]
  );
  res.json({ success: true, message: 'User updated' });
}));

router.delete('/users/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  // Soft delete — block and anonymise
  await query("UPDATE users SET is_blocked=TRUE, full_name='[Deleted User]', mobile=CONCAT('DEL_',mobile), email=NULL, updated_at=NOW() WHERE id=$1", [req.params.id]);
  res.json({ success: true, message: 'User removed' });
}));

// ── Department / Team CRUD ────────────────────────────────────────────────────
router.post('/departments', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name required' });
  const id = uuidv4();
  await query('INSERT INTO departments (id, name) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING', [id, name]);
  res.status(201).json({ success: true, id, message: 'Department created' });
}));

router.patch('/departments/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  await query('UPDATE departments SET name=$1 WHERE id=$2', [name, req.params.id]);
  res.json({ success: true, message: 'Department updated' });
}));

router.patch('/team-members/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, role, departmentId, isActive, newPassword } = req.body;
  if (newPassword) {
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE team_members SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
  }
  await query(
    'UPDATE team_members SET full_name=COALESCE($1,full_name), role=COALESCE($2,role), department_id=COALESCE($3,department_id), is_active=COALESCE($4,is_active) WHERE id=$5',
    [fullName, role, departmentId, isActive !== undefined ? isActive : null, req.params.id]
  );
  res.json({ success: true, message: 'Team member updated' });
}));

// ── Events CRUD ────────────────────────────────────────────────────────────────
router.patch('/events/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, description, eventDate, location } = req.body;
  await query('UPDATE events SET title=COALESCE($1,title), description=COALESCE($2,description), event_date=COALESCE($3,event_date), location=COALESCE($4,location) WHERE id=$5',
    [title, description, eventDate, location, req.params.id]);
  res.json({ success: true, message: 'Event updated' });
}));

router.delete('/events/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM events WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Event deleted' });
}));

// ── Announcements CRUD ────────────────────────────────────────────────────────
router.get('/announcements', asyncHandler(async (_req, res) => {
  const result = await query('SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC LIMIT 50');
  res.json({ success: true, announcements: result.rows });
}));

router.post('/announcements', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, target, ward, isPinned } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, message: 'title and body required' });
  const id = uuidv4();
  const username = req.user.username || ADMIN_USERNAME;
  await query('INSERT INTO announcements (id, title, body, target, ward, is_pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, title, body, target || 'all', ward || null, isPinned || false, username]);
  res.status(201).json({ success: true, id, message: 'Announcement created' });
}));

router.patch('/announcements/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, target, ward, isPinned } = req.body;
  await query('UPDATE announcements SET title=COALESCE($1,title), body=COALESCE($2,body), target=COALESCE($3,target), ward=COALESCE($4,ward), is_pinned=COALESCE($5,is_pinned), updated_at=NOW() WHERE id=$6',
    [title, body, target, ward, isPinned !== undefined ? isPinned : null, req.params.id]);
  res.json({ success: true, message: 'Announcement updated' });
}));

router.delete('/announcements/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Announcement deleted' });
}));

module.exports = router;
