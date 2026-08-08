const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../config/db');

// Best-effort in-app notification — never throws, so a notification failure
// (or a DB hiccup) can never block the ticket/SOS/visit action it's attached to.
async function notify(recipientId, recipientRole, title, body, type) {
  try {
    await query(
      'INSERT INTO notifications (id, user_id, recipient_role, title, body, type) VALUES ($1,$2,$3,$4,$5,$6)',
      [uuidv4(), recipientId, recipientRole, title, body, type]
    );
  } catch (err) {
    console.error('notify() failed (non-fatal):', err.message);
  }
}

const notifyCitizen = (userId, title, body, type) => notify(userId, 'citizen', title, body, type);
const notifyTeamMember = (teamMemberId, title, body, type) => notify(teamMemberId, 'team_member', title, body, type);

// Notify every active member of a department (SOS, new tickets needing attention)
async function notifyDepartment(departmentId, title, body, type) {
  if (!departmentId) return;
  try {
    const members = await query('SELECT id FROM team_members WHERE department_id=$1 AND is_active=TRUE', [departmentId]);
    await Promise.all(members.rows.map((m) => notifyTeamMember(m.id, title, body, type)));
  } catch (err) {
    console.error('notifyDepartment() failed (non-fatal):', err.message);
  }
}

module.exports = { notifyCitizen, notifyTeamMember, notifyDepartment };
