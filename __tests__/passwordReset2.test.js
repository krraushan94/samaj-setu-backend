// Split from passwordFlow.test.js purely so these tests get their own fresh
// universalPasswordResetLimiter instance (see the note at the bottom of that file).
const { mockQuery } = require('./helpers/dbMock');
const bcrypt = require('bcryptjs');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');

beforeEach(() => mockQuery.mockReset());

describe('POST /api/auth/forgot-password + /api/auth/reset-password — edge cases', () => {
  it('sends an emailed code for an email that matches a team member', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // users
      .mockResolvedValueOnce({ rows: [{ id: 'team-uuid-1' }] }) // team_members match
      .mockResolvedValueOnce({ rows: [] }) // admin_users
      .mockResolvedValueOnce({ rows: [] }); // password_resets insert
    const res = await request(app).post('/api/auth/forgot-password').send({ identifier: 'leader@example.com' });
    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO password_resets'));
    expect(insertCall).toBeTruthy();
  });

  it('rejects a garbage identifier', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ identifier: 'not-a-mobile-or-email' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid/expired code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no matching otp/reset record
    const res = await request(app).post('/api/auth/reset-password')
      .send({ identifier: '9812345678', code: '000000', newPassword: 'BrandNewPass1' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the code is valid but no account matches', async () => {
    const otpHash = await bcrypt.hash('654321', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash }] })
      .mockResolvedValueOnce({ rows: [] }) // mark used
      .mockResolvedValueOnce({ rows: [] }) // users — no match
      .mockResolvedValueOnce({ rows: [] }); // team_members — no match
    const res = await request(app).post('/api/auth/reset-password')
      .send({ identifier: '9812345678', code: '654321', newPassword: 'BrandNewPass1' });
    expect(res.status).toBe(404);
  });
});
