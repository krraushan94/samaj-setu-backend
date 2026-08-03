const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, adminToken, leaderToken, mockUser } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Get My Profile ────────────────────────────────────────────────────────────
describe('GET /api/users/me', () => {
  it('returns current citizen profile', async () => {
    mockQuery.mockResolvedValue({ rows: [mockUser] });
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.user.mobile).toBe('9999900000');
  });

  it('returns 404 if user not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });
});

// ─── Update Profile ────────────────────────────────────────────────────────────
describe('PATCH /api/users/me', () => {
  it('citizen can update their own profile', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ fullName: 'Updated Name', ward: '6' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Profile updated');
  });
});

// ─── Admin List Users ─────────────────────────────────────────────────────────
describe('GET /api/users', () => {
  it('admin can list all users', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.total).toBe(1);
  });

  it('citizen cannot list all users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });

  it('search by name works', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(app)
      .get('/api/users?search=Raushan')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── Block / Unblock ──────────────────────────────────────────────────────────
describe('PATCH /api/users/:id/block', () => {
  it('admin can block a user', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch('/api/users/user-uuid-1/block')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ blocked: true });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User blocked');
  });

  it('admin can unblock a user', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .patch('/api/users/user-uuid-1/block')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ blocked: false });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User unblocked');
  });

  it('team leader cannot block users', async () => {
    const res = await request(app)
      .patch('/api/users/user-uuid-1/block')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ blocked: true });
    expect(res.status).toBe(403);
  });
});
