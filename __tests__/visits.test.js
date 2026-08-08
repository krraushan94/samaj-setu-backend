const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, adminToken, leaderToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

const validPayload = {
  visitorName: 'Test Citizen', contactMobile: '9999900000', address: 'Hatiara, New Town',
  reason: 'Discuss ticket escalation', numberOfPersons: 2, aadharNumber: '123456789012',
};

// ─── Create Visit Request ──────────────────────────────────────────────────────
describe('POST /api/visits', () => {
  it('citizen can create a visit request', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1', ...validPayload, status: 'pending' }] });
    const res = await request(app).post('/api/visits')
      .set('Authorization', `Bearer ${citizenToken()}`).send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.visit.status).toBe('pending');
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/visits')
      .set('Authorization', `Bearer ${citizenToken()}`).send({ ...validPayload, reason: '' });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range number of persons', async () => {
    const res = await request(app).post('/api/visits')
      .set('Authorization', `Bearer ${citizenToken()}`).send({ ...validPayload, numberOfPersons: 50 });
    expect(res.status).toBe(400);
  });

  it('team leader cannot create a visit request', async () => {
    const res = await request(app).post('/api/visits')
      .set('Authorization', `Bearer ${leaderToken()}`).send(validPayload);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await request(app).post('/api/visits').send(validPayload);
    expect(res.status).toBe(401);
  });
});

// ─── My Visits ──────────────────────────────────────────────────────────────────
describe('GET /api/visits/my', () => {
  it("returns the citizen's own visit requests", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1', ...validPayload, status: 'pending' }] });
    const res = await request(app).get('/api/visits/my').set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
  });
});

// ─── Cancel Visit ────────────────────────────────────────────────────────────────
describe('PATCH /api/visits/:id/cancel', () => {
  it('citizen can cancel their own request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/visits/visit-1/cancel')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
  });

  it("cannot cancel another citizen's request", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] });
    const res = await request(app).patch('/api/visits/visit-1/cancel')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent visit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/visits/nope/cancel')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(404);
  });
});

// ─── Admin: List & Schedule ────────────────────────────────────────────────────
describe('GET /api/visits (admin)', () => {
  it('admin can list all visit requests', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1', ...validPayload, status: 'pending' }] });
    const res = await request(app).get('/api/visits').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
  });

  it('team leader cannot list visit requests', async () => {
    const res = await request(app).get('/api/visits').set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/visits/:id/schedule', () => {
  it('admin can assign a scheduled time', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1', status: 'scheduled', scheduled_time: 'Mon 10am' }] });
    const res = await request(app).patch('/api/visits/visit-1/schedule')
      .set('Authorization', `Bearer ${adminToken()}`).send({ scheduledTime: 'Mon 10am' });
    expect(res.status).toBe(200);
    expect(res.body.visit.status).toBe('scheduled');
  });

  it('rejects scheduling without a time', async () => {
    const res = await request(app).patch('/api/visits/visit-1/schedule')
      .set('Authorization', `Bearer ${adminToken()}`).send({});
    expect(res.status).toBe(400);
  });

  it('admin can cancel a request with a note, no time required', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'visit-1', status: 'cancelled' }] });
    const res = await request(app).patch('/api/visits/visit-1/schedule')
      .set('Authorization', `Bearer ${adminToken()}`).send({ status: 'cancelled', adminNote: 'Office closed that day' });
    expect(res.status).toBe(200);
    expect(res.body.visit.status).toBe('cancelled');
  });

  it('returns 404 for a non-existent visit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/visits/nope/schedule')
      .set('Authorization', `Bearer ${adminToken()}`).send({ scheduledTime: 'Mon 10am' });
    expect(res.status).toBe(404);
  });

  it('notifies the citizen who requested the visit once scheduled', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'visit-1', user_id: 'user-uuid-1', status: 'scheduled', scheduled_time: 'Mon 10am' }] })
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app).patch('/api/visits/visit-1/schedule')
      .set('Authorization', `Bearer ${adminToken()}`).send({ scheduledTime: 'Mon 10am' });
    expect(res.status).toBe(200);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert[1]).toEqual(expect.arrayContaining(['user-uuid-1', 'citizen']));
  });
});
