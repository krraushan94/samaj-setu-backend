const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');

const router = Router();

// Get current user profile
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const result = await query('SELECT id, full_name, mobile, email, gender, age_group, pincode, mandal, ward, colony, is_verified, profile_photo, created_at FROM users WHERE id=$1', [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, user: result.rows[0] });
}));

// Update profile
router.patch('/me', verifyToken, asyncHandler(async (req, res) => {
  const { fullName, email, pincode, mandal, ward, colony } = req.body;
  await query(
    'UPDATE users SET full_name=COALESCE($1,full_name), email=COALESCE($2,email), pincode=COALESCE($3,pincode), mandal=COALESCE($4,mandal), ward=COALESCE($5,ward), colony=COALESCE($6,colony), updated_at=NOW() WHERE id=$7',
    [fullName, email, pincode, mandal, ward, colony, req.user.id]
  );
  res.json({ success: true, message: 'Profile updated' });
}));

// Admin: list all users
router.get('/', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, search } = req.query;
  const offset = (page - 1) * limit;
  const params = [`%${search || ''}%`, limit, offset];
  const result = await query(
    `SELECT id, full_name, mobile, email, ward, mandal, is_verified, is_blocked, created_at
     FROM users WHERE (full_name ILIKE $1 OR mobile ILIKE $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    params
  );
  const count = await query(`SELECT COUNT(*) FROM users WHERE full_name ILIKE $1 OR mobile ILIKE $1`, [`%${search || ''}%`]);
  res.json({ success: true, users: result.rows, total: +count.rows[0].count });
}));

// Admin: block/unblock user
router.patch('/:id/block', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { blocked } = req.body;
  await query('UPDATE users SET is_blocked=$1 WHERE id=$2', [blocked, req.params.id]);
  res.json({ success: true, message: blocked ? 'User blocked' : 'User unblocked' });
}));

module.exports = router;
