const { Router } = require('express');
const { verifyToken, requireAdmin, requireTeamLeader } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const bcrypt = require('bcryptjs');
const { randomUUID: uuidv4 } = require('crypto');
const {
  UNCAPPED_MEMBERS_DEPARTMENT, MAX_TEAM_LEADERS_OTHERS,
  MAX_TEAM_LEADERS_DEFAULT, MAX_TEAM_MEMBERS_DEFAULT,
} = require('../../config/constants');

const router = Router();

// "Others" flexes wider (more real-world variety funnels into it) — every other
// department maps to one specific team, so it's capped tighter.
async function checkTeamCap(departmentId, role) {
  const dept = await query('SELECT name FROM departments WHERE id=$1', [departmentId]);
  const deptName = dept.rows[0]?.name;
  const isOthers = deptName === UNCAPPED_MEMBERS_DEPARTMENT;

  if (role === 'leader') {
    const max = isOthers ? MAX_TEAM_LEADERS_OTHERS : MAX_TEAM_LEADERS_DEFAULT;
    const count = await query("SELECT COUNT(*) FROM team_members WHERE department_id=$1 AND role='leader' AND is_active=TRUE", [departmentId]);
    if (+count.rows[0].count >= max) {
      return `${deptName || 'This department'} already has the maximum of ${max} team leader${max > 1 ? 's' : ''}`;
    }
    return null;
  }

  if (isOthers) return null; // no cap on members in "Others"
  const count = await query("SELECT COUNT(*) FROM team_members WHERE department_id=$1 AND role='member' AND is_active=TRUE", [departmentId]);
  if (+count.rows[0].count >= MAX_TEAM_MEMBERS_DEFAULT) {
    return `${deptName || 'This department'} already has the maximum of ${MAX_TEAM_MEMBERS_DEFAULT} team members`;
  }
  return null;
}

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

// Add team leader or member to a department — admin only. Admins can add either role;
// team leaders (below) can only add members to their own department.
router.post('/:id/members', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  const { fullName, username, password, role } = req.body;
  if (!fullName || !username || !password) {
    return res.status(400).json({ success: false, message: 'Full name, username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }
  const finalRole = role === 'leader' ? 'leader' : 'member';
  const capError = await checkTeamCap(req.params.id, finalRole);
  if (capError) return res.status(403).json({ success: false, message: capError });

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO team_members (id, department_id, full_name, username, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), req.params.id, fullName, username, passwordHash, finalRole]
  );
  res.status(201).json({ success: true, message: 'Team member added' });
}));

// A team leader adding a member to their own department — always role 'member', always
// their own department_id (from the token, not client input, so they can't add to a
// department they don't lead).
router.post('/members', verifyToken, requireTeamLeader, asyncHandler(async (req, res) => {
  if (req.user.role !== 'leader') {
    return res.status(403).json({ success: false, message: 'Only team leaders can add members this way — admins use POST /departments/:id/members' });
  }
  const { fullName, username, password } = req.body;
  if (!fullName || !username || !password) {
    return res.status(400).json({ success: false, message: 'Full name, username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }
  const capError = await checkTeamCap(req.user.departmentId, 'member');
  if (capError) return res.status(403).json({ success: false, message: capError });

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO team_members (id, department_id, full_name, username, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), req.user.departmentId, fullName, username, passwordHash, 'member']
  );
  res.status(201).json({ success: true, message: 'Team member added' });
}));

// Remove team member (admin only)
router.delete('/members/:id', verifyToken, requireAdmin, asyncHandler(async (req, res) => {
  await query('UPDATE team_members SET is_active=FALSE WHERE id=$1', [req.params.id]);
  res.json({ success: true, message: 'Member deactivated' });
}));

module.exports = router;
