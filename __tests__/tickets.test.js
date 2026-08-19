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

  it('retries with a fresh ticket number if a rare ticket_number collision occurs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'male' }] })   // get user gender
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] }) // find dept
      .mockResolvedValueOnce({ rows: [] })                      // moderation flagged-terms lookup
      .mockRejectedValueOnce({ code: '23505' })                 // first insert attempt: collides
      .mockResolvedValueOnce({ rows: [] })                      // second insert attempt: succeeds
      .mockResolvedValueOnce({ rows: [] });                     // audit log
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`).send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^SJT-\d{4}-/);
  });

  it('gives up and surfaces a 409 after repeated ticket_number collisions', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'male' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValue({ code: '23505' }); // every insert attempt collides
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`).send(validPayload);
    expect(res.status).toBe(409);
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
      .mockResolvedValueOnce({ rows: [] })   // insert ticket
      .mockResolvedValueOnce({ rows: [] })   // audit log
      .mockResolvedValueOnce({ rows: [] });  // notifyDepartment: no team members found, nothing to notify
    const res = await request(app)
      .post('/api/tickets/sos')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ latitude: 22.5726, longitude: 88.3639, locationText: 'Hatiara main road' });
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^SJT-/);
  });

  it('SOS notifies every active team member of the routed department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ full_name: 'Test User', gender: 'female' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })   // insert ticket
      .mockResolvedValueOnce({ rows: [] })   // audit log
      .mockResolvedValueOnce({ rows: [{ id: 'team-uuid-1' }, { id: 'team-uuid-2' }] }) // active team members
      .mockResolvedValueOnce({ rows: [] })   // notification insert for team-uuid-1
      .mockResolvedValueOnce({ rows: [] });  // notification insert for team-uuid-2
    const res = await request(app)
      .post('/api/tickets/sos')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ latitude: 22.5726, longitude: 88.3639, locationText: 'Hatiara main road' });
    expect(res.status).toBe(201);
    const notifyInserts = mockQuery.mock.calls.filter(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInserts).toHaveLength(2);
    expect(notifyInserts[0][1]).toEqual(expect.arrayContaining(['team-uuid-1', 'team_member']));
    expect(notifyInserts[1][1]).toEqual(expect.arrayContaining(['team-uuid-2', 'team_member']));
  });
});

// ─── BMS Labour Details ────────────────────────────────────────────────────────
describe('POST /api/tickets — BMS labour details', () => {
  const labourPayload = (overrides = {}) => ({
    category: 'labour', subCategory: 'Domestic Worker / Maid – Salary Delayed or Not Paid',
    title: 'Salary not paid for two months', description: 'Employer stopped paying since June',
    locationText: 'Hatiara Colony',
    labourDetails: {
      fullName: 'Sunita Roy', organisationName: 'Sharma Household',
      liveLocation: '22.65432, 88.45123', aadharNumber: '123456789012', ...overrides,
    },
  });

  it('rejects a labour ticket with no worker full name', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ fullName: '' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/full name/i);
  });

  it('rejects a labour ticket with no organisation name', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ organisationName: '' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/organisation/i);
  });

  it('rejects a labour ticket with no live location', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ liveLocation: '' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/location/i);
  });

  it('rejects a labour ticket with neither Aadhaar nor Voter ID', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ aadharNumber: '' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aadhaar|voter/i);
  });

  it('rejects a labour ticket with a malformed Aadhaar number', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ aadharNumber: '12345' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/12 digits/i);
  });

  it('rejects a labour ticket with a malformed Voter ID', async () => {
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ aadharNumber: '', voterIdNumber: 'not-a-real-epic' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/voter id/i);
  });

  it('accepts a Voter ID in place of Aadhaar', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'female' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-bms' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ aadharNumber: '', voterIdNumber: 'ABC1234567' }));
    expect(res.status).toBe(201);
  });

  it('creates a valid labour ticket and persists only the known labour_details fields as JSON', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'female' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-bms' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send(labourPayload({ sector: 'unorganized', extraHackerField: 'should be dropped' }));
    expect(res.status).toBe(201);

    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO tickets'));
    const labourDetailsJson = insertCall[1][15];
    const stored = JSON.parse(labourDetailsJson);
    expect(stored.fullName).toBe('Sunita Roy');
    expect(stored.organisationName).toBe('Sharma Household');
    expect(stored.liveLocation).toBe('22.65432, 88.45123');
    expect(stored.sector).toBe('unorganized');
    expect(stored.extraHackerField).toBeUndefined();
  });

  it('does not require labourDetails for non-labour categories', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ gender: 'male' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/tickets').set('Authorization', `Bearer ${citizenToken()}`)
      .send({ category: 'infrastructure', subCategory: 'street_light', title: 'Light broken', locationText: 'Ward 5' });
    expect(res.status).toBe(201);
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

  it('notifies the citizen who owns the ticket when its status changes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'open', department_id: 'dept-uuid-1', user_id: 'user-uuid-1', ticket_number: 'SJT-2026-ABCDE' }] })
      .mockResolvedValueOnce({ rows: [] })  // update ticket
      .mockResolvedValueOnce({ rows: [] })  // insert history
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/status')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ status: 'resolved', note: 'Fixed the streetlight' });
    expect(res.status).toBe(200);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert[1]).toEqual(expect.arrayContaining(['user-uuid-1', 'citizen']));
  });
});

// ─── Assign ────────────────────────────────────────────────────────────────────
describe('PATCH /api/tickets/:id/assign', () => {
  it('notifies the assigned team member', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department_id: 'dept-uuid-1', ticket_number: 'SJT-2026-ABCDE' }] })
      .mockResolvedValueOnce({ rows: [] })  // update ticket
      .mockResolvedValueOnce({ rows: [] }); // notification insert
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/assign')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ assignedTo: 'team-uuid-2' });
    expect(res.status).toBe(200);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert[1]).toEqual(expect.arrayContaining(['team-uuid-2', 'team_member']));
  });

  it('does not attempt to notify when unassigning (assignedTo empty)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department_id: 'dept-uuid-1', ticket_number: 'SJT-2026-ABCDE' }] })
      .mockResolvedValueOnce({ rows: [] }); // update ticket
    const res = await request(app)
      .patch('/api/tickets/ticket-uuid-1/assign')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ assignedTo: '' });
    expect(res.status).toBe(200);
    const notifyInsert = mockQuery.mock.calls.find(c => c[0].includes('INSERT INTO notifications'));
    expect(notifyInsert).toBeUndefined();
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
