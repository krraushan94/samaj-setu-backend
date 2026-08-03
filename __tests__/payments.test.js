const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, leaderToken, adminToken, mockPayment } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Initiate Payment ──────────────────────────────────────────────────────────
describe('POST /api/payments/initiate', () => {
  it('generates reference number for payment_pending ticket', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-uuid-1', status: 'payment_pending' }] })
      .mockResolvedValueOnce({ rows: [] })   // no existing payment
      .mockResolvedValueOnce({ rows: [] });  // insert payment
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ticketId: 'ticket-uuid-1' });
    expect(res.status).toBe(201);
    expect(res.body.referenceNumber).toMatch(/^PAY-\d{4}-/);
    expect(res.body.amount).toBe(50);
    expect(res.body.method).toBe('cash');
    expect(res.body.instructions).toContain('₹50');
  });

  it('returns existing reference if payment already initiated', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ticket-uuid-1', status: 'payment_pending' }] })
      .mockResolvedValueOnce({ rows: [{ reference_number: 'PAY-2026-EXIST1' }] });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ticketId: 'ticket-uuid-1' });
    expect(res.status).toBe(200);
    expect(res.body.referenceNumber).toBe('PAY-2026-EXIST1');
  });

  it('returns 404 for ticket not belonging to citizen', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ticketId: 'other-uuid' });
    expect(res.status).toBe(404);
  });

  it('returns 400 if ticket not in payment_pending status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ticket-uuid-1', status: 'open' }] });
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ ticketId: 'ticket-uuid-1' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/payments/initiate').send({ ticketId: 'any' });
    expect(res.status).toBe(401);
  });

  it('blocks non-citizens from initiating payment', async () => {
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ ticketId: 'ticket-uuid-1' });
    expect(res.status).toBe(403);
  });
});

// ─── Confirm Payment ──────────────────────────────────────────────────────────
describe('POST /api/payments/:id/confirm', () => {
  it('team leader can confirm cash payment and activates ticket', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                    // update payment status
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'ticket-uuid-1' }] })    // get ticket id
      .mockResolvedValueOnce({ rows: [] });                                   // activate ticket
    const res = await request(app)
      .post('/api/payments/pay-uuid-1/confirm')
      .set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('confirmed');
  });

  it('citizen cannot confirm payment', async () => {
    const res = await request(app)
      .post('/api/payments/pay-uuid-1/confirm')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });

  it('admin can confirm payment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'ticket-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/payments/pay-uuid-1/confirm')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── List Payments ─────────────────────────────────────────────────────────────
describe('GET /api/payments', () => {
  it('team leader can list payments', async () => {
    mockQuery.mockResolvedValue({ rows: [mockPayment] });
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
  });

  it('citizen cannot list all payments', async () => {
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(403);
  });

  it('filters by status=pending', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/payments?status=pending')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});
