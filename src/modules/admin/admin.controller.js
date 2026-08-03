const { query } = require('../../config/db');
const { asyncHandler } = require('../../middleware/errorHandler');

// Master dashboard stats
const getDashboardStats = asyncHandler(async (_req, res) => {
  const [tickets, payments, users, criticalTickets] = await Promise.all([
    query(`SELECT status, COUNT(*) AS count FROM tickets GROUP BY status`),
    query(`SELECT status, COALESCE(SUM(amount),0) AS total FROM payments GROUP BY status`),
    query(`SELECT COUNT(*) AS total FROM users WHERE is_blocked=FALSE`),
    query(`SELECT COUNT(*) AS count FROM tickets WHERE priority='critical' AND status NOT IN ('resolved','closed')`),
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
      cashCollected: paymentStats.confirmed || 0,
      cashPending: paymentStats.pending || 0,
    },
  });
});

// Raw table browser — Admin_Raushan only
const ALLOWED_TABLES = [
  'users', 'tickets', 'payments', 'media_attachments',
  'audit_logs', 'departments', 'team_members', 'notifications',
  'app_impressions', 'ticket_history', 'events', 'missing_persons',
];

const browseTable = asyncHandler(async (req, res) => {
  const { table } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ success: false, message: 'Table not allowed' });
  }
  const { page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;

  // Simple full-row count
  const countResult = await query(`SELECT COUNT(*) FROM "${table}"`);
  const total = +countResult.rows[0].count;

  const result = await query(`SELECT * FROM "${table}" ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);

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
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ success: false, message: 'Table not allowed' });
  }
  const result = await query(`SELECT * FROM "${table}" ORDER BY created_at DESC`);
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
