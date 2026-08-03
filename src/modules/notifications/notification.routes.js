const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const { randomUUID: uuidv4 } = require('crypto');

const router = Router();

// Get user's notifications
router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json({ success: true, notifications: result.rows });
}));

// Mark as read
router.patch('/:id/read', verifyToken, asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
}));

// Broadcast to all users (admin only)
router.post('/broadcast', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, type } = req.body;
  const users = await query('SELECT id FROM users WHERE is_blocked=FALSE');
  const inserts = users.rows.map(u =>
    query('INSERT INTO notifications (id, user_id, title, body, type) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), u.id, title, body, type || 'announcement'])
  );
  await Promise.all(inserts);
  // TODO: send FCM push notifications when Firebase is configured
  res.json({ success: true, sent: users.rows.length });
}));

module.exports = router;
