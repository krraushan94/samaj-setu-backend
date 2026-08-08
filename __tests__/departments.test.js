const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { adminToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

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
