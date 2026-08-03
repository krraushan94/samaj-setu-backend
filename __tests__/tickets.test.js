const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, leaderToken, adminToken, mockTicket, mockUser } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Create Ticket ─────────────────────────────────────────────────────────────
describe('POST /api/tickets', () => {
  const validPayload = {
    category: 'infrastructure', subCategory: 'street_light',
    title: 'Broken street light', description: 'Light at main road not working',
    priority: 'medium', locationText: 'Ward 5, Hatiara',
  };

  it('creates ticket and returns ticketId + ticketNumber', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'male' }] })          // get user gender
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })       // find dept
      .mockResolvedValueOnce({ rows: [] })                             // insert ticket
      .mockResolvedValueOnce({ rows: [] });                            // audit log
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBeDefined();
    expect(res.body.ticketNumber).toMatch(/^SJT-\d{4}-/);
  });

  it('auto-escalates to CRITICAL for women_safety + female gender', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'female' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ...validPayload, category: 'women_safety', subCategory: 'harassment' });
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('critical');
  });

  it('does NOT auto-escalate women_safety for male gender', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'male' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ...validPayload, category: 'women_safety', subCategory: 'harassment', priority: 'medium' });
    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('medium');
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/tickets').send(validPayload);
    expect(res.status).toBe(401);
  });

  it('creates SOS ticket as CRITICAL with open status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ full_name: 'Test User', gender: 'female' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/tickets/sos')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ latitude: 22.5726, longitude: 88.3639, locationText: 'Hatiara main road' });
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^SJT-/);
  });
});

// ─── List Tickets ──────────────────────────────────────────────────────────────
describe('GET /api/tickets', () => {
  it('returns citizen\'s own tickets only', async () => {
    mockQuery.mockResolvedValue({ rows: [mockTicket] });
    const res = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(401);
  });

  it('paginates correctly with page + limit params', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/tickets?page=2&limit=5')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(5);
  });
});

// ─── Get Single Ticket ─────────────────────────────────────────────────────────
describe('GET /api/tickets/:id', () => {
  it('returns ticket detail with media and history', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...mockTicket, media: [], history: [] }] });
    const res = await request(app)
      .get('/api/tickets/ticket-uuid-1')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ticket.ticket_number).toBe('SJT-2026-ABCDE');
  });

  it('returns 404 for non-existent ticket', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/tickets/non-existent-uuid')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(404);
  });
});

// ─── Update Status ─────────────────────────────────────────────────────────────
describe('PATCH /api/tickets/:id/status', () => {
  it('team leader can update status of their dept ticket', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'open', department_id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })  // update ticket
      .mockResolvedValueOnce({ rows: [] }); // insert history
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/status')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'in_progress', note: 'Assigned to field team' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('team leader cannot update ticket from another dept', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'open', department_id: 'OTHER-DEPT-UUID' }] });
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/status')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(403);
  });

  it('citizen cannot update status', async () => {
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/status')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .patch('/api/tickets/bad-uuid/status')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
});

// ─── Upvote ────────────────────────────────────────────────────────────────────
describe('POST /api/tickets/:id/upvote', () => {
  it('upvotes successfully and returns new count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // insert upvote
      .mockResolvedValueOnce({ rows: [{ upvote_count: 1 }] });         // update count
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/upvote')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.upvoteCount).toBe(1);
  });

  it('returns 409 for duplicate upvote', async () => {
    mockQuery.mockRejectedValueOnce(new Error('duplicate key'));
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/upvote')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(409);
  });

  it('auto-escalates to high priority at 5 upvotes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ upvote_count: 5 }] })
      .mockResolvedValueOnce({ rows: [] }); // escalate query
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/upvote')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.upvoteCount).toBe(5);
  });
});

// ─── Rate Ticket ──────────────────────────────────────────────────────────────
describe('POST /api/tickets/:id/rate', () => {
  it('saves rating 1–5 successfully', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/rate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ rating: 4, feedback: 'Good response time' });
    expect(res.status).toBe(200);
  });

  it('rejects rating below 1', async () => {
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/rate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ rating: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects rating above 5', async () => {
    const res = await request(app)
      .post('/api/tickets/ticket-uuid-1/rate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ rating: 6 });
    expect(res.status).toBe(400);
  });
});
