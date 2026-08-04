const { Router } = require('express');
const { verifyToken, requireAdmin } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const bcrypt = require('bcryptjs');
const { randomUUID: uuidv4 } = require('crypto');

const router = Router();

// List departments — this endpoint has no auth (mobile shows department names publicly),
// so team_members must only expose non-sensitive columns. Never select password_hash here.
router.get('/', asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT d.*,
            json_agg(
              json_build_object(
                'id', tm.id, 'full_name', tm.full_name, 'username', tm.username,
                'role', tm.role, 'is_active', tm.is_active, 'created_at', tm.created_at
              )
            ) FILTER (WHERE tm.id IS NOT NULL) AS members
     FROM departments d
     LEFT JOIN team_members tm ON tm.department_id = d.id
     GROUP BY d.id ORDER BY d.name`
  );
  res.json({ success: true, departments: result.rows });
}));

// Add team member to department (admin only)
router.post('/:id/members', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, username, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO team_members (id, department_id, full_name, username, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), req.params.id, fullName, username, passwordHash, role || 'member']
  );
  res.status(201).json({ success: true, message: 'Team member added' });
}));

// Remove team member (admin only)
router.delete('/members/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('UPDATE team_members SET is_active=FALSE WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Member deactivated' });
}));

module.exports = router;
