const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken, leaderToken, memberToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Validation branches on both "add member" endpoints ───────────────────────
describe('POST /api/departments/:id/members — validation', () => {
  it('rejects a missing fullName/username/password', async () => {
    const res = await request(app).post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: '', username: '', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a password under 8 characters', async () => {
    const res = await request(app).post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Someone', username: 'someone1', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/);
  });

  it('defaults role to "member" when role is omitted or unrecognized', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Others' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/departments/dept-others/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Someone', username: 'someone2', password: 'SecurePass1', role: 'not-a-real-role' });
    expect(res.status).toBe(201);
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO team_members'));
    expect(insertCall[1]).toEqual(expect.arrayContaining(['member']));
  });
});

// ─── Team leader self-service member add ───────────────────────────────────────
describe('POST /api/departments/members — team leader adds to own department', () => {
  it('lets a leader add a member to their own department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Social Welfare' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ fullName: 'New Member', username: 'new_member1', password: 'SecurePass1' });
    expect(res.status).toBe(201);
  });

  it('rejects a plain team member (not a leader) using this route — blocked by requireTeamLeader middleware', async () => {
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ fullName: 'New Member', username: 'new_member2', password: 'SecurePass1' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/team leader access required/i);
  });

  it('rejects an admin using this route — admins use POST /:id/members instead', async () => {
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'New Member', username: 'new_member2b', password: 'SecurePass1' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only team leaders can add members this way/i);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ fullName: '', username: '', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ fullName: 'New Member', username: 'new_member3', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 characters/);
  });

  it('is blocked by the department member cap same as the admin route', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Social Welfare' }] })
      .mockResolvedValueOnce({ rows: [{ count: '20' }] });
    const res = await request(app).post('/api/departments/members')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ fullName: 'One Too Many', username: 'over_cap', password: 'SecurePass1' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/maximum of 20/);
  });
});

// ─── Team leader cap — 3 for a regular department, 5 for "Others" ────────────
describe('POST /api/departments/:id/members — team leader caps', () => {
  it('allows a 3rd leader in a regular department (cap raised from 2 to 3)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Social Welfare' }] }) // dept lookup
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // existing leader count
      .mockResolvedValueOnce({ rows: [] }); // insert
    const res = await request(app).post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Third Leader', username: 'leader3', password: 'Leader@Pass1', role: 'leader' });
    expect(res.status).toBe(201);
  });

  it('blocks a 4th leader in a regular department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Social Welfare' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });
    const res = await request(app).post('/api/departments/dept-uuid-1/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Fourth Leader', username: 'leader4', password: 'Leader@Pass1', role: 'leader' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/maximum of 3/);
  });

  it('allows a 5th leader in "Others"', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Others' }] })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/departments/dept-others/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Fifth Leader', username: 'leader5', password: 'Leader@Pass1', role: 'leader' });
    expect(res.status).toBe(201);
  });

  it('blocks a 6th leader in "Others"', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Others' }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] });
    const res = await request(app).post('/api/departments/dept-others/members')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ fullName: 'Sixth Leader', username: 'leader6', password: 'Leader@Pass1', role: 'leader' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/maximum of 5/);
  });
});
