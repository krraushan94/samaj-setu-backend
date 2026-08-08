const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, leaderToken, adminToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

describe('GET /api/notifications', () => {
  it("scopes a citizen's request to recipient_role='citizen'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'Ticket updated' }] });
    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['user-uuid-1', 'citizen']));
  });

  it("scopes a team leader's request to recipient_role='team_member'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'New ticket assigned' }] });
    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${leaderToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['team-uuid-1', 'team_member']));
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('marks a citizen notification as read scoped to citizen role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/notifications/n1/read').set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['n1', 'user-uuid-1', 'citizen']));
  });
});

describe('POST /api/notifications/broadcast', () => {
  it('admin can broadcast to all non-blocked users', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1' }, { id: 'user-uuid-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/notifications/broadcast')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ title: 'Office closed', body: 'Closed for a local holiday tomorrow.' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
  });

  it('non-admin cannot broadcast', async () => {
    const res = await request(app).post('/api/notifications/broadcast')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ title: 'x', body: 'y' });
    expect(res.status).toBe(403);
  });
});
