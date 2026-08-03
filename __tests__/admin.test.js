const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken, citizenToken, leaderToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Master Stats ──────────────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  it('Admin_Raushan can access master stats', async () => {
    // Must mock all 4 parallel queries in getDashboardStats
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'open', count: '10' }] })           // tickets by status
      .mockResolvedValueOnce({ rows: [{ status: 'pending', total: '500' }] })       // payments by status
      .mockResolvedValueOnce({ rows: [{ total: '120' }] })                          // total users
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });                           // critical active
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
  });

  it('team leader cannot access admin stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(403);
  });

  it('citizen cannot access admin stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ─── DB Browser ───────────────────────────────────────────────────────────────
describe('GET /api/admin/db/:table', () => {
  const VALID_TABLES = ['users', 'tickets', 'payments', 'media_attachments',
    'audit_logs', 'departments', 'team_members', 'notifications',
    'app_impressions', 'ticket_history', 'events', 'missing_persons'];

  VALID_TABLES.forEach(table => {
    it(`Admin can browse "${table}" table`, async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })   // count
        .mockResolvedValueOnce({ rows: [] });                   // data
      const res = await request(app)
        .get(`/api/admin/db/${table}`)
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.table).toBe(table);
    });
  });

  it('returns 400 for unknown/disallowed table', async () => {
    const res = await request(app)
      .get('/api/admin/db/pg_secret_passwords')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for SQL-injection attempt in table name', async () => {
    const res = await request(app)
      .get('/api/admin/db/users; DROP TABLE users;--')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it('non-admin cannot browse tables', async () => {
    const res = await request(app)
      .get('/api/admin/db/users')
      .set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(403);
  });
});

// ─── CSV Export ───────────────────────────────────────────────────────────────
describe('GET /api/admin/export/:table', () => {
  it('returns CSV content-type for valid table', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'uuid-1', full_name: 'Test User' }] });
    const res = await request(app)
      .get('/api/admin/export/users')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('id');
    expect(res.text).toContain('full_name');
  });

  it('returns empty CSV with headers for empty table', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/admin/export/tickets')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });

  it('blocks disallowed table export', async () => {
    const res = await request(app)
      .get('/api/admin/export/system_config')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });
});

// ─── App Impressions ──────────────────────────────────────────────────────────
describe('POST /api/admin/impressions (record)', () => {
  it('citizen can record their impression', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/admin/impressions')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ screen: 'Home', action: 'view', sessionId: 'sess-abc' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/admin/impressions (analytics)', () => {
  it('admin gets daily, screen, and top users analytics', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ date: '2026-08-01', sessions: 5, events: 100 }] })
      .mockResolvedValueOnce({ rows: [{ screen: 'Home', views: 50 }] })
      .mockResolvedValueOnce({ rows: [{ full_name: 'Test', mobile: '9999900000', actions: 10 }] });
    const res = await request(app)
      .get('/api/admin/impressions')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.daily).toBeDefined();
    expect(res.body.screens).toBeDefined();
    expect(res.body.topUsers).toBeDefined();
  });

  it('non-admin cannot read impressions analytics', async () => {
    const res = await request(app)
      .get('/api/admin/impressions')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });
});
