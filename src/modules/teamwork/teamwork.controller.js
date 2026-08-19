const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { asyncHandler } = require('../../middleware/errorHandler');
const { notifyTeamMember } = require('../../utils/notify');

// Own department for leader/member; admin can target any department via
// query (?departmentId=) or body (departmentId), or omit for "all departments".
const scopedDepartmentId = (req, fromBody = false) => {
  if (req.user.role === 'admin') return (fromBody ? req.body.departmentId : req.query.departmentId) || null;
  return req.user.departmentId;
};

const actorName = (req) => req.user.username || (req.user.role === 'admin' ? 'Admin' : 'Team');

// ─── Tasks ──────────────────────────────────────────────────────────────────────

const listTasks = asyncHandler(async (req, res) => {
  const departmentId = scopedDepartmentId(req);
  const { status, assignedTo } = req.query;
  const conditions = [];
  const params = [];

  if (departmentId) conditions.push(`t.department_id = $${params.push(departmentId)}`);
  if (status) conditions.push(`t.status = $${params.push(status)}`);
  if (assignedTo) conditions.push(`t.assigned_to = $${params.push(assignedTo)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT t.*, d.name AS department_name
     FROM team_tasks t
     LEFT JOIN departments d ON t.department_id = d.id
     ${where}
     ORDER BY CASE t.status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
              t.due_date ASC NULLS LAST, t.created_at DESC`,
    params
  );
  res.json({ success: true, tasks: result.rows });
});

const createTask = asyncHandler(async (req, res) => {
  if (req.user.role === 'member') {
    return res.status(403).json({ success: false, message: 'Only team leaders and admin can create tasks' });
  }
  const { title, description, assignedTo, dueDate, priority } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });

  const departmentId = scopedDepartmentId(req, true);
  if (!departmentId) return res.status(400).json({ success: false, message: 'departmentId is required' });

  let assignedToName = null;
  if (assignedTo) {
    const assignee = await query('SELECT full_name, department_id FROM team_members WHERE id=$1', [assignedTo]);
    if (!assignee.rows.length) return res.status(400).json({ success: false, message: 'Assignee not found' });
    if (assignee.rows[0].department_id !== departmentId) {
      return res.status(400).json({ success: false, message: 'Assignee is not in this department' });
    }
    assignedToName = assignee.rows[0].full_name;
  }

  const id = uuidv4();
  const result = await query(
    `INSERT INTO team_tasks (id, department_id, title, description, assigned_to, assigned_to_name, created_by, created_by_role, created_by_name, priority, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, departmentId, title.trim(), description || null, assignedTo || null, assignedToName,
     req.user.id, req.user.role, actorName(req), priority || 'medium', dueDate || null]
  );

  if (assignedTo) {
    await notifyTeamMember(assignedTo, 'New task assigned', `"${title.trim()}" was assigned to you.`, 'task_assigned', { entityType: 'task', entityId: id });
  }
  res.status(201).json({ success: true, task: result.rows[0] });
});

const updateTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const current = await query('SELECT * FROM team_tasks WHERE id=$1', [id]);
  if (!current.rows.length) return res.status(404).json({ success: false, message: 'Task not found' });
  const task = current.rows[0];

  const inScope = req.user.role === 'admin' || task.department_id === req.user.departmentId;
  if (!inScope) return res.status(403).json({ success: false, message: 'Not your department' });

  if (req.user.role === 'member') {
    if (task.assigned_to !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only update tasks assigned to you' });
    }
    // Members may only move progress along, not rewrite/reassign the task
    const { status, progressNote } = req.body;
    const result = await query(
      'UPDATE team_tasks SET status=COALESCE($1,status), progress_note=COALESCE($2,progress_note), updated_at=NOW() WHERE id=$3 RETURNING *',
      [status || null, progressNote ?? null, id]
    );
    if (status === 'completed' && task.created_by_role === 'leader') {
      await notifyTeamMember(task.created_by, 'Task completed', `"${task.title}" was marked completed by ${actorName(req)}.`, 'task_status', { entityType: 'task', entityId: id });
    }
    return res.json({ success: true, task: result.rows[0] });
  }

  // Leader / admin — full edit, including reassignment
  const { title, description, status, progressNote, dueDate, priority, assignedTo } = req.body;
  let assignedToName = task.assigned_to_name;
  if (assignedTo !== undefined && assignedTo !== task.assigned_to) {
    if (assignedTo) {
      const assignee = await query('SELECT full_name, department_id FROM team_members WHERE id=$1', [assignedTo]);
      if (!assignee.rows.length) return res.status(400).json({ success: false, message: 'Assignee not found' });
      if (assignee.rows[0].department_id !== task.department_id) {
        return res.status(400).json({ success: false, message: 'Assignee is not in this department' });
      }
      assignedToName = assignee.rows[0].full_name;
    } else {
      assignedToName = null;
    }
  }

  const result = await query(
    `UPDATE team_tasks SET
       title=COALESCE($1,title), description=COALESCE($2,description), status=COALESCE($3,status),
       progress_note=COALESCE($4,progress_note), due_date=COALESCE($5,due_date), priority=COALESCE($6,priority),
       assigned_to=COALESCE($7,assigned_to), assigned_to_name=$8, updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [title || null, description ?? null, status || null, progressNote ?? null, dueDate || null,
     priority || null, assignedTo || null, assignedToName, id]
  );

  if (assignedTo && assignedTo !== task.assigned_to) {
    await notifyTeamMember(assignedTo, 'Task assigned to you', `"${result.rows[0].title}" was assigned to you.`, 'task_assigned', { entityType: 'task', entityId: id });
  }
  res.json({ success: true, task: result.rows[0] });
});

// Admin-only cross-department overview
const taskSummary = asyncHandler(async (_req, res) => {
  const byStatus = await query(
    `SELECT d.name AS department_name, t.status, COUNT(*) AS count
     FROM team_tasks t JOIN departments d ON t.department_id = d.id
     GROUP BY d.name, t.status ORDER BY d.name`
  );
  const overdue = await query(
    `SELECT COUNT(*) FROM team_tasks WHERE due_date < CURRENT_DATE AND status != 'completed'`
  );
  res.json({ success: true, byStatus: byStatus.rows, overdueCount: +overdue.rows[0].count });
});

// ─── Chat ───────────────────────────────────────────────────────────────────────

const listMessages = asyncHandler(async (req, res) => {
  const departmentId = scopedDepartmentId(req);
  if (!departmentId) return res.status(400).json({ success: false, message: 'departmentId is required' });

  const result = await query(
    `SELECT * FROM (
       SELECT * FROM team_messages WHERE department_id=$1 ORDER BY created_at DESC LIMIT 100
     ) recent ORDER BY created_at ASC`,
    [departmentId]
  );
  res.json({ success: true, messages: result.rows });
});

const postMessage = asyncHandler(async (req, res) => {
  const departmentId = scopedDepartmentId(req, true);
  if (!departmentId) return res.status(400).json({ success: false, message: 'departmentId is required' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

  const result = await query(
    'INSERT INTO team_messages (id, department_id, sender_id, sender_role, sender_name, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [uuidv4(), departmentId, req.user.id, req.user.role, actorName(req), message.trim()]
  );
  res.status(201).json({ success: true, message: result.rows[0] });
});

module.exports = { listTasks, createTask, updateTask, taskSummary, listMessages, postMessage };
