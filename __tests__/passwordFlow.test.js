const { mockQuery } = require('./helpers/dbMock');
const bcrypt = require('bcryptjs');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const app = require('../src/app');
const { citizenToken, leaderToken, memberToken, adminToken } = require('./helpers/fixtures');

beforeEach(() => mockQuery.mockReset());

// ─── Change password (logged in, any role) ─────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  it('citizen changes password with a correct current password', async () => {
    const hash = await bcrypt.hash('OldPass1', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1', password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [] }); // update
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ currentPassword: 'OldPass1', newPassword: 'NewPass123' });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const hash = await bcrypt.hash('OldPass1', 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1', password_hash: hash }] });
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ currentPassword: 'WrongPass', newPassword: 'NewPass123' });
    expect(res.status).toBe(401);
  });

  it("rejects a new password under 8 characters", async () => {
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .send({ currentPassword: 'OldPass1', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it("leader's first-ever password change requires email + mobile, and saves them", async () => {
    const hash = await bcrypt.hash('Admin-Issued-1', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'team-uuid-1', password_hash: hash, password_set_at: null }] })
      .mockResolvedValueOnce({ rows: [] }); // update
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ currentPassword: 'Admin-Issued-1', newPassword: 'MyOwnPass1', email: 'leader@example.com', mobile: '9812345678' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining(['leader@example.com', '9812345678']));
  });

  it("leader's first-ever password change is rejected without email/mobile", async () => {
    const hash = await bcrypt.hash('Admin-Issued-1', 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'team-uuid-1', password_hash: hash, password_set_at: null }] });
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .send({ currentPassword: 'Admin-Issued-1', newPassword: 'MyOwnPass1' });
    expect(res.status).toBe(400);
  });

  it("member's later password change (already set once) doesn't require email/mobile again", async () => {
    const hash = await bcrypt.hash('MyOwnPass1', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'team-uuid-2', password_hash: hash, password_set_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${memberToken()}`)
      .send({ currentPassword: 'MyOwnPass1', newPassword: 'EvenNewerPass1' });
    expect(res.status).toBe(200);
  });

  it('admin changes password via the admin_users table', async () => {
    const hash = await bcrypt.hash('AdminOld1', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'Admin_Raushan', password_hash: hash }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ currentPassword: 'AdminOld1', newPassword: 'AdminNew123' });
    expect(res.status).toBe(200);
  });
});

// ─── Forgot / reset password (public, any role) ────────────────────────────────
describe('POST /api/auth/forgot-password + /api/auth/reset-password', () => {
  it('sends an OTP for a mobile number that matches an account', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1' }] }) // users match
      .mockResolvedValueOnce({ rows: [] }) // team_members no match
      .mockResolvedValueOnce({ rows: [] }); // otp insert
    const res = await request(app).post('/api/auth/forgot-password').send({ identifier: '9812345678' });
    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO otp_verifications'));
    expect(insertCall).toBeTruthy();
  });

  it('does not send anything for a mobile with no matching account, but still responds success (no enumeration)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/forgot-password').send({ identifier: '9800000000' });
    expect(res.status).toBe(200);
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO otp_verifications'));
    expect(insertCall).toBeFalsy();
  });

  it('resets a team member password via a valid mobile OTP and returns a leader/member token', async () => {
    const otpHash = await bcrypt.hash('654321', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash }] }) // otp lookup
      .mockResolvedValueOnce({ rows: [] }) // mark otp used
      .mockResolvedValueOnce({ rows: [] }) // users lookup — no match
      .mockResolvedValueOnce({ rows: [{ id: 'team-uuid-2', role: 'member', department_id: 'dept-uuid-1', username: 'member.x' }] }) // team_members match
      .mockResolvedValueOnce({ rows: [] }); // update team_members
    const res = await request(app).post('/api/auth/reset-password')
      .send({ identifier: '9812345678', code: '654321', newPassword: 'BrandNewPass1' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('member');
    expect(res.body.accessToken).toBeTruthy();
  });
});
// The remaining forgot/reset-password edge cases live in passwordReset2.test.js — split into
// a separate file so each gets its own universalPasswordResetLimiter instance (jest resets the
// module registry per test file); otherwise this file alone would exceed the real 5/hour cap
// the limiter is meant to enforce, which isn't something a test should need to work around.
