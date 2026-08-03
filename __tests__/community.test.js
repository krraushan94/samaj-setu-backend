const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, adminToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Community Board ───────────────────────────────────────────────────────────
describe('GET /api/community/board', () => {
  it('returns public board without authentication', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'ticket-1', title: 'Broken light', status: 'open', upvote_count: 3 }] });
    const res = await request(app).get('/api/community/board');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('filters by ward parameter', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/community/board?ward=5');
    expect(res.status).toBe(200);
  });

  it('filters by status parameter', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/community/board?status=resolved');
    expect(res.status).toBe(200);
  });

  it('filters by category parameter', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/community/board?category=infrastructure');
    expect(res.status).toBe(200);
  });

  it('paginates with page and limit', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/community/board?page=3&limit=10');
    expect(res.status).toBe(200);
  });
});

// ─── Events ────────────────────────────────────────────────────────────────────
describe('GET /api/community/events', () => {
  it('returns events publicly', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'evt-1', title: 'Community Meet', event_date: new Date() }] });
    const res = await request(app).get('/api/community/events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });
});

describe('POST /api/community/events', () => {
  it('admin can create event', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/community/events')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Blood Donation Camp', description: 'Free camp', eventDate: '2026-09-01', location: 'Hatiara Club' });
    expect(res.status).toBe(201);
  });

  it('citizen cannot create event', async () => {
    const res = await request(app)
      .post('/api/community/events')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ title: 'Test Event' });
    expect(res.status).toBe(403);
  });
});

// ─── Missing Persons ──────────────────────────────────────────────────────────
describe('GET /api/community/missing', () => {
  it('returns active missing persons publicly', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/community/missing');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.persons)).toBe(true);
  });
});

describe('POST /api/community/missing', () => {
  it('logged-in citizen can report missing person', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/community/missing')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ name: 'Raju', age: 12, gender: 'male', lastSeen: 'Hatiara market', contact: '9999911111' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('unauthenticated user cannot report missing person', async () => {
    const res = await request(app)
      .post('/api/community/missing')
      .send({ name: 'Unknown' });
    expect(res.status).toBe(401);
  });
});
