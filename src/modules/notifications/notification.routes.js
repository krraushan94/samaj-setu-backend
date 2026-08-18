const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const { randomUUID: uuidv4 } = require('crypto');

const router = Router();

// Get user's notifications — citizens and team members (leader/member) are recorded
// under different recipient_role buckets since notifications.user_id can point at
// either the users or team_members table (no shared FK — see migrate_v7.js)
const recipientRole = (role) => (role === 'leader' || role === 'member') ? 'team_member' : 'citizen';

router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM notifications WHERE user_id=$1 AND recipient_role=$2 ORDER BY created_at DESC LIMIT 50',
    [req.user.id, recipientRole(req.user.role)]
  );
  res.json({ success: true, notifications: result.rows });
}));

// Mark as read
router.patch('/:id/read', verifyToken, asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 AND recipient_role=$3',
    [req.params.id, req.user.id, recipientRole(req.user.role)]);
  res.json({ success: true });
}));

// Broadcast to all users (admin only)
router.post('/broadcast', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, type } = req.body;
  const users = await query('SELECT id FROM users WHERE is_blocked=FALSE');

  if (users.rows.length) {
    // Single batched INSERT via unnest() instead of one query per recipient — the old loop
    // opened as many concurrent pool connections as there were users, which doesn't scale
    // past a modest user base.
    const n = users.rows.length;
    await query(
      `INSERT INTO notifications (id, user_id, title, body, type)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[])`,
      [
        Array.from({ length: n }, () => uuidv4()),
        users.rows.map((u) => u.id),
        Array(n).fill(title),
        Array(n).fill(body),
        Array(n).fill(type || 'announcement'),
      ]
    );
  }
  // TODO: send FCM push notifications when Firebase is configured — needs a device push-token
  // column (none exists yet on users/team_members) and mobile-side registration, so this is a
  // separate feature, not a one-line fix alongside the DB-row write above.
  res.json({ success: true, sent: users.rows.length });
}));

module.exports = router;
