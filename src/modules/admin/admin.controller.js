const { query } = require('../../config/db');
const { asyncHandler } = require('../../middleware/errorHandler');
const { ADMIN_USERNAME } = require('../../config/constants');

// Master dashboard stats — cash figures are omitted for sub-admins (financial data
// stays with Admin_Raushan only); everything else is fine for any admin to see.
const getDashboardStats = asyncHandler(async (req, res) => {
  const isPrimaryAdmin = req.user?.username === ADMIN_USERNAME;
  const [tickets, payments, users, criticalTickets, needsReview, reportedPosts] = await Promise.all([
    query(`SELECT status, COUNT(*) AS count FROM tickets GROUP BY status`),
    isPrimaryAdmin
      ? query(`SELECT status, COALESCE(SUM(amount),0) AS total FROM payments GROUP BY status`)
      : Promise.resolve({ rows: [] }),
    query(`SELECT COUNT(*) AS total FROM users WHERE is_blocked=FALSE`),
    query(`SELECT COUNT(*) AS count FROM tickets WHERE priority='critical' AND status NOT IN ('resolved','closed')`),
    query(`SELECT COUNT(*) AS count FROM tickets WHERE needs_review=TRUE`),
    query(`SELECT COUNT(DISTINCT ticket_id) AS count FROM post_reports`),
  ]);

  const ticketStats = Object.fromEntries(tickets.rows.map(r => [r.status, +r.count]));
  const paymentStats = Object.fromEntries(payments.rows.map(r => [r.status, +r.total]));

  res.json({
    success: true,
    stats: {
      tickets: ticketStats,
      totalTickets: Object.values(ticketStats).reduce((a, b) => a + b, 0),
      criticalActive: +criticalTickets.rows[0].count,
      totalUsers: +users.rows[0].total,
      ...(isPrimaryAdmin ? { cashCollected: paymentStats.confirmed || 0, cashPending: paymentStats.pending || 0 } : {}),
      needsReview: +needsReview.rows[0].count,
      reportedPosts: +reportedPosts.rows[0].count,
    },
  });
});

// Raw table browser — Admin_Raushan only
const ALLOWED_TABLES = [
  'users', 'tickets', 'payments', 'media_attachments',
  'audit_logs', 'departments', 'team_members', 'notifications',
  'app_impressions', 'ticket_history', 'events', 'missing_persons', 'office_visits',
];

// Every table above sorts by created_at except 'departments', which never got one (it's just
// id + name) — browsing/exporting it used to throw a raw Postgres "column does not exist" error.
const ORDER_COLUMN = { departments: 'name' };

// `table` is checked against ALLOWED_TABLES below, but since it still gets interpolated
// directly into the SQL text (Postgres has no way to parameterize an identifier), this adds a
// second, independent structural check — so a future edit to the whitelist (e.g. pasting in a
// value that was never meant to be a literal table name) can't reopen SQL injection on its own.
const isValidTableName = (table) => /^[a-z_]+$/.test(table) && ALLOWED_TABLES.includes(table);

const browseTable = asyncHandler(async (req, res) => {
  const { table } = req.params;
  if (!isValidTableName(table)) {
    return res.status(400).json({ success: false, message: 'Table not allowed' });
  }
  const { page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;
  const orderCol = ORDER_COLUMN[table] || 'created_at';

  // Generic text search across every column, without needing to know this table's schema:
  // casting the whole row to text and doing a substring match. Not index-backed, but this is
  // a low-traffic admin tool, not a citizen-facing search.
  const searchClause = search ? `WHERE t::text ILIKE $1` : '';
  const searchParams = search ? [`%${search}%`] : [];

  const countResult = await query(`SELECT COUNT(*) FROM "${table}" t ${searchClause}`, searchParams);
  const total = +countResult.rows[0].count;

  const result = await query(
    `SELECT t.* FROM "${table}" t ${searchClause} ORDER BY "${orderCol}" DESC LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`,
    [...searchParams, limit, offset]
  );
  // Never surface password hashes, even to Admin_Raushan — there's no legitimate use for them
  // here and it's needless exposure if this screen is ever shared or the session compromised.
  result.rows.forEach((row) => delete row.password_hash);

  res.json({ success: true, table, total, page: +page, limit: +limit, rows: result.rows });
});

// App impressions analytics
const getImpressions = asyncHandler(async (_req, res) => {
  const [daily, screens, topUsers] = await Promise.all([
    query(`SELECT DATE(created_at) AS date, COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events
           FROM app_impressions WHERE created_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at) ORDER BY date`),
    query(`SELECT screen, COUNT(*) AS views FROM app_impressions GROUP BY screen ORDER BY views DESC LIMIT 20`),
    query(`SELECT u.full_name, u.mobile, COUNT(ai.id) AS actions
           FROM app_impressions ai JOIN users u ON ai.user_id=u.id
           GROUP BY u.id, u.full_name, u.mobile ORDER BY actions DESC LIMIT 20`),
  ]);
  res.json({ success: true, daily: daily.rows, screens: screens.rows, topUsers: topUsers.rows });
});

// Record impression (called from mobile app)
const recordImpression = asyncHandler(async (req, res) => {
  const { screen, action, sessionId, deviceInfo } = req.body;
  const { randomUUID: uuidv4 } = require('crypto');
  await query(
    'INSERT INTO app_impressions (id, user_id, screen, action, session_id, device_info) VALUES ($1,$2,$3,$4,$5,$6)',
    [uuidv4(), req.user?.id || null, screen, action || null, sessionId || null, deviceInfo ? JSON.stringify(deviceInfo) : null]
  );
  res.json({ success: true });
});

// CSV export for any allowed table
const exportTable = asyncHandler(async (req, res) => {
  const { table } = req.params;
  if (!isValidTableName(table)) {
    return res.status(400).json({ success: false, message: 'Table not allowed' });
  }
  const orderCol = ORDER_COLUMN[table] || 'created_at';
  const result = await query(`SELECT * FROM "${table}" ORDER BY "${orderCol}" DESC`);
  result.rows.forEach((row) => delete row.password_hash);
  if (!result.rows.length) return res.json({ success: true, csv: '' });

  const headers = Object.keys(result.rows[0]).join(',');
  const rows = result.rows.map(row =>
    Object.values(row).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
  res.send(csv);
});

// Department-wise ticket stats
const getDeptStats = asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT d.name, t.priority, t.status, COUNT(*) AS count
     FROM tickets t JOIN departments d ON t.department_id=d.id
     GROUP BY d.name, t.priority, t.status ORDER BY d.name`
  );
  res.json({ success: true, stats: result.rows });
});

module.exports = { getDashboardStats, browseTable, getImpressions, recordImpression, exportTable, getDeptStats };
