const { mockQuery } = require('./helpers/dbMock');
const bcrypt = require('bcryptjs');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());
jest.mock('../src/config/sms', () => ({ sendOtpSms: jest.fn().mockResolvedValue({ delivered: false, reason: 'not_configured' }) }));

// Must load app AFTER mocks are set up
const app = require('../src/app');
const { sendOtpSms } = require('../src/config/sms');
const { citizenToken, adminToken, leaderToken, mockUser } = require('./helpers/fixtures');

beforeEach(() => {
  mockQuery.mockReset();
  sendOtpSms.mockClear();
  sendOtpSms.mockResolvedValue({ delivered: false, reason: 'not_configured' });
});

// ─── OTP Send ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/send-otp', () => {
  it('returns 200 for valid 10-digit mobile', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for non-10-digit mobile', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '12345' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for alphabetic mobile', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: 'abcdefghij' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty mobile', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for 11-digit mobile', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '98765432101' });
    expect(res.status).toBe(400);
  });

  it("returns 502 (not a false 'success') when Fast2SMS genuinely fails to deliver", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    sendOtpSms.mockResolvedValue({ delivered: false, reason: 'provider_error' });
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9876543210' });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });

  it('treats missing Fast2SMS credentials as a failure in production too, not a silent no-op success', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    mockQuery.mockResolvedValue({ rows: [] });
    sendOtpSms.mockResolvedValue({ delivered: false, reason: 'not_configured' });
    const res = await request(app).post('/api/auth/send-otp').send({ mobile: '9876543210' });
    process.env.NODE_ENV = originalEnv;
    expect(res.status).toBe(502);
  });
});

// ─── OTP Verify ───────────────────────────────────────────────────────────────
describe('POST /api/auth/verify-otp', () => {
  it('returns isNewUser=false and NO tokens for an already-registered mobile (OTP is one-time, not a login method)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const futureDate = new Date(Date.now() + 600000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash, expires_at: futureDate, used: false }] })
      .mockResolvedValueOnce({ rows: [] }) // mark used
      .mockResolvedValueOnce({ rows: [{ id: mockUser.id }] }); // find user
    const res = await request(app).post('/api/auth/verify-otp').send({ mobile: '9999900000', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.alreadyRegistered).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('returns isNewUser=true and tempToken for new user', async () => {
    const otpHash = await bcrypt.hash('654321', 10);
    const futureDate = new Date(Date.now() + 600000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash, expires_at: futureDate, used: false }] })
      .mockResolvedValueOnce({ rows: [] })  // mark used
      .mockResolvedValueOnce({ rows: [] }); // no user found
    const res = await request(app).post('/api/auth/verify-otp').send({ mobile: '9876500000', otp: '654321' });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.tempToken).toBeDefined();
  });

  it('returns 400 for expired OTP', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no valid OTP found
    const res = await request(app).post('/api/auth/verify-otp').send({ mobile: '9999900000', otp: '000000' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for wrong OTP', async () => {
    const otpHash = await bcrypt.hash('111111', 10);
    const futureDate = new Date(Date.now() + 600000);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash, expires_at: futureDate, used: false }] });
    const res = await request(app).post('/api/auth/verify-otp').send({ mobile: '9999900000', otp: '999999' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid otp/i);
  });
});

// ─── Registration validation ────────────────────────────────────────────────────
describe('POST /api/auth/register — validation', () => {
  const jwt = require('jsonwebtoken');
  const tempToken = () => jwt.sign({ mobile: '9999911111', role: 'pending' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const validBody = () => ({
    tempToken: tempToken(), firstName: 'Test', lastName: 'User', pincode: '700157',
    ward: '5', colony: 'Hatiara', password: 'SecurePass123', voterIdNumber: 'ABC1234567',
  });

  it('rejects registration with no password', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...validBody(), password: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
  });

  it('rejects registration with neither Aadhaar nor Voter ID', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...validBody(), voterIdNumber: '' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/aadhaar|voter/i);
  });

  it('accepts registration with Aadhaar number instead of Voter ID', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no existing user
      .mockResolvedValueOnce({ rows: [{ id: 'new-user', mobile: '9999911111' }] }); // insert returns user
    const res = await request(app).post('/api/auth/register').send({ ...validBody(), voterIdNumber: '', aadharNumber: '123456789012' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
  });
});

// ─── Citizen Password Reset ────────────────────────────────────────────────────
describe('POST /api/auth/citizen/reset-password', () => {
  it('resets password and returns tokens for a valid OTP', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const futureDate = new Date(Date.now() + 600000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'otp-id', otp_hash: otpHash, expires_at: futureDate, used: false }] })
      .mockResolvedValueOnce({ rows: [] }) // mark used
      .mockResolvedValueOnce({ rows: [mockUser] }) // find user
      .mockResolvedValueOnce({ rows: [] }); // update password
    const res = await request(app).post('/api/auth/citizen/reset-password')
      .send({ mobile: '9999900000', otp: '123456', newPassword: 'NewSecurePass123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects a short new password', async () => {
    const res = await request(app).post('/api/auth/citizen/reset-password')
      .send({ mobile: '9999900000', otp: '123456', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for expired/missing OTP', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/citizen/reset-password')
      .send({ mobile: '9999900000', otp: '000000', newPassword: 'NewSecurePass123' });
    expect(res.status).toBe(400);
  });
});

// ─── Admin Login ──────────────────────────────────────────────────────────────
describe('POST /api/auth/login — Admin', () => {
  it('returns 401 for wrong admin username (falls to team branch)', async () => {
    // Set up mock before request so team-member lookup returns nothing
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/auth/login').send({ username: 'WrongAdmin', password: 'any' });
    expect(res.status).toBe(401);
  });

  it('returns 503 when ADMIN_PASSWORD_HASH not configured', async () => {
    const orig = process.env.ADMIN_PASSWORD_HASH;
    process.env.ADMIN_PASSWORD_HASH = '';
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no admin in DB — falls back to env hash
    const res = await request(app).post('/api/auth/login').send({ username: 'Admin_Raushan', password: 'any' });
    expect(res.status).toBe(503);
    process.env.ADMIN_PASSWORD_HASH = orig;
  });
});

// ─── JWT Refresh ──────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  it('returns new tokens for valid refresh token', async () => {
    const jwt = require('jsonwebtoken');
    const refreshToken = jwt.sign({ id: 'user-1', role: 'citizen' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'invalid.token.here' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for expired refresh token', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign({ id: 'u1', role: 'citizen' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: expired });
    expect(res.status).toBe(401);
  });
});
