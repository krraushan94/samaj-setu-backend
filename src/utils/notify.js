const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../config/db');
const { sendPushNotification } = require('./expoPush');

// Best-effort in-app notification — never throws, so a notification failure
// (or a DB hiccup) can never block the ticket/SOS/visit action it's attached to.
// entity{Type,Id} let the client route a tap straight to what the notification is about
// (a ticket, a task, ...) instead of only being able to mark it read.
async function notify(recipientId, recipientRole, title, body, type, entity = {}) {
  try {
    await query(
      'INSERT INTO notifications (id, user_id, recipient_role, title, body, type, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [uuidv4(), recipientId, recipientRole, title, body, type, entity.entityType || null, entity.entityId || null]
    );
  } catch (err) {
    console.error('notify() failed (non-fatal):', err.message);
  }

  // Also push, if this recipient has a device registered — citizens live in `users`,
  // team leaders/members live in `team_members`. Fire-and-forget: a push failure must never
  // surface to the caller, the in-app notification above already succeeded independently.
  try {
    const result = recipientRole === 'citizen'
      ? await query('SELECT push_token FROM users WHERE id=$1', [recipientId])
      : await query('SELECT push_token FROM team_members WHERE id=$1', [recipientId]);
    const token = result.rows[0]?.push_token;
    if (token) await sendPushNotification(token, title, body, { entityType: entity.entityType, entityId: entity.entityId, type });
  } catch (err) {
    console.error('notify() push lookup failed (non-fatal):', err.message);
  }
}

const notifyCitizen = (userId, title, body, type, entity) => notify(userId, 'citizen', title, body, type, entity);
const notifyTeamMember = (teamMemberId, title, body, type, entity) => notify(teamMemberId, 'team_member', title, body, type, entity);

// Notify every active member of a department (SOS, new tickets needing attention)
async function notifyDepartment(departmentId, title, body, type, entity) {
  if (!departmentId) return;
  try {
    const members = await query('SELECT id FROM team_members WHERE department_id=$1 AND is_active=TRUE', [departmentId]);
    await Promise.all(members.rows.map((m) => notifyTeamMember(m.id, title, body, type, entity)));
  } catch (err) {
    console.error('notifyDepartment() failed (non-fatal):', err.message);
  }
}

module.exports = { notifyCitizen, notifyTeamMember, notifyDepartment };
