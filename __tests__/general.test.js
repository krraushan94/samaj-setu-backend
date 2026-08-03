const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken, citizenToken, leaderToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Middleware: Auth ──────────────────────────────────────────────────────────
describe('Auth Middleware', () => {
  it('rejects requests with malformed Bearer token', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('rejects requests with Bearer but empty token', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('rejects requests with non-Bearer scheme', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });
});

// ─── Health Check ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.app).toBe('Samaj Setu API');
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
describe('Unknown routes', () => {
  it('returns 404 for unknown GET route', async () => {
    const res = await request(app).get('/api/unknown-route-xyz');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown POST route', async () => {
    const res = await request(app).post('/api/does-not-exist').send({});
    expect(res.status).toBe(404);
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
describe('CORS headers', () => {
  it('health endpoint responds to OPTIONS preflight', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:3000');
    expect([200, 204]).toContain(res.status);
  });
});

// ─── Constants Logic ──────────────────────────────────────────────────────────
describe('Constants: CATEGORY_DEPARTMENT_MAP', () => {
  const { CATEGORY_DEPARTMENT_MAP, WOMEN_SAFETY_CATEGORIES, DEPARTMENTS } = require('../src/config/constants');

  it('maps all 12 categories to a valid department', () => {
    Object.values(CATEGORY_DEPARTMENT_MAP).forEach(dept => {
      expect(DEPARTMENTS).toContain(dept);
    });
  });

  it('women_safety maps to Social Welfare', () => {
    expect(CATEGORY_DEPARTMENT_MAP['women_safety']).toBe('Social Welfare');
  });

  it('development maps to Politics', () => {
    expect(CATEGORY_DEPARTMENT_MAP['development']).toBe('Politics');
  });

  it('feedback maps to Marketing', () => {
    expect(CATEGORY_DEPARTMENT_MAP['feedback']).toBe('Marketing');
  });

  it('women safety categories includes all known harassment types', () => {
    const required = ['eve_teasing', 'harassment', 'domestic_violence', 'stalking'];
    required.forEach(c => expect(WOMEN_SAFETY_CATEGORIES).toContain(c));
  });
});

// ─── Notifications ─────────────────────────────────────────────────────────────
describe('Notifications', () => {
  it('citizen can get their notifications', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
  });

  it('admin can broadcast notification to all users', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] })
      .mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Community Event', body: 'Join us Sunday', type: 'announcement' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
  });

  it('citizen cannot broadcast notifications', async () => {
    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ title: 'test', body: 'test' });
    expect(res.status).toBe(403);
  });

  it('citizen can mark notification as read', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch('/api/notifications/notif-uuid-1/read')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── Departments ───────────────────────────────────────────────────────────────
describe('Departments', () => {
  it('anyone can list departments', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'dept-1', name: 'Social Welfare', members: [] }] });
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.departments)).toBe(true);
  });

  it('admin can add team member to department', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'New Leader', username: 'new_leader', password: 'SecurePass@123', role: 'leader' });
    expect(res.status).toBe(201);
  });

  it('citizen cannot add team members', async () => {
    const res = await request(app)
      .post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ fullName: 'Hack Attempt', username: 'hacker', password: 'pass', role: 'leader' });
    expect(res.status).toBe(403);
  });

  it('admin can deactivate team member', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .delete('/api/departments/members/member-uuid-1')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
