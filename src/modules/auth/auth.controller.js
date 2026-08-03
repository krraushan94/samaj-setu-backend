const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { ADMIN_USERNAME } = require('../../config/constants');
const { asyncHandler } = require('../../middleware/errorHandler');

const generateTokens = (payload) => ({
  accessToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  refreshToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }),
});

// Send OTP — stores hashed OTP; in production, calls MSG91
const sendOtp = asyncHandler(async (req, res) => {
  const { mobile } = req.body;
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await query(
    'INSERT INTO otp_verifications (id, mobile, otp_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [uuidv4(), mobile, otpHash, expiresAt]
  );

  // TODO: call MSG91 API here with otp when keys are configured
  console.log(`[DEV] OTP for ${mobile}: ${otp}`);

  res.json({ success: true, message: 'OTP sent successfully' });
});

// Verify OTP
const verifyOtp = asyncHandler(async (req, res) => {
  const { mobile, otp } = req.body;
  const result = await query(
    'SELECT * FROM otp_verifications WHERE mobile=$1 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [mobile]
  );
  if (!result.rows.length) {
    return res.status(400).json({ success: false, message: 'OTP expired or not found' });
  }
  const record = result.rows[0];
  const valid = await bcrypt.compare(otp, record.otp_hash);
  if (!valid) return res.status(400).json({ success: false, message: 'Invalid OTP' });

  await query('UPDATE otp_verifications SET used=TRUE WHERE id=$1', [record.id]);

  // Check if user already exists
  const userResult = await query('SELECT * FROM users WHERE mobile=$1', [mobile]);
  const user = userResult.rows[0];

  if (user) {
    const tokens = generateTokens({ id: user.id, role: 'citizen', mobile: user.mobile });
    return res.json({ success: true, isNewUser: false, ...tokens, user });
  }
  // New user — return temp token for registration completion
  const tempToken = jwt.sign({ mobile, role: 'pending' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  res.json({ success: true, isNewUser: true, tempToken });
});

// Complete registration
const register = asyncHandler(async (req, res) => {
  const { tempToken, fullName, email, gender, ageGroup, pincode, mandal, ward, colony, password } = req.body;
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid registration session' });
  }
  if (decoded.role !== 'pending') {
    return res.status(400).json({ success: false, message: 'Invalid token type' });
  }

  const existing = await query('SELECT id FROM users WHERE mobile=$1', [decoded.mobile]);
  if (existing.rows.length) {
    return res.status(409).json({ success: false, message: 'User already registered' });
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const result = await query(
    `INSERT INTO users (id, full_name, mobile, email, gender, age_group, pincode, mandal, ward, colony, password_hash, is_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE) RETURNING *`,
    [uuidv4(), fullName, decoded.mobile, email || null, gender || null, ageGroup || null,
     pincode || null, mandal || null, ward || null, colony || null, passwordHash]
  );
  const user = result.rows[0];
  const tokens = generateTokens({ id: user.id, role: 'citizen', mobile: user.mobile });
  res.status(201).json({ success: true, ...tokens, user });
});

// Login (citizen password, team leader, admin)
const login = asyncHandler(async (req, res) => {
  const { username, password, mobile } = req.body;

  // Admin login — check admin_users table first, fall back to env hash for Admin_Raushan
  if (username === ADMIN_USERNAME || (username && !mobile)) {
    // Try DB-stored admin first
    const dbAdmin = await query('SELECT * FROM admin_users WHERE username=$1 AND is_active=TRUE', [username]).catch(() => ({ rows: [] }));
    if (dbAdmin.rows.length) {
      const valid = await bcrypt.compare(password, dbAdmin.rows[0].password_hash);
      if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
      await query('UPDATE admin_users SET last_login=NOW() WHERE username=$1', [username]).catch(() => {});
      const tokens = generateTokens({ id: dbAdmin.rows[0].id, role: 'admin', username, email: dbAdmin.rows[0].email });
      return res.json({ success: true, role: 'admin', admin: { username, email: dbAdmin.rows[0].email, fullName: dbAdmin.rows[0].full_name }, ...tokens });
    }
    // Fall back to env hash (Admin_Raushan only)
    if (username === ADMIN_USERNAME) {
      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      if (!adminHash) return res.status(503).json({ success: false, message: 'Admin not configured' });
      const valid = await bcrypt.compare(password, adminHash);
      if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
      const tokens = generateTokens({ id: 'admin', role: 'admin', username: ADMIN_USERNAME });
      return res.json({ success: true, role: 'admin', admin: { username: ADMIN_USERNAME, email: 'sihsraushandc@gmail.com' }, ...tokens });
    }
  }

  // Team member login
  if (username) {
    const result = await query('SELECT * FROM team_members WHERE username=$1 AND is_active=TRUE', [username]);
    const member = result.rows[0];
    if (!member) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, member.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const tokens = generateTokens({ id: member.id, role: member.role, departmentId: member.department_id, username });
    return res.json({ success: true, role: member.role, member, ...tokens });
  }

  // Citizen password login
  if (mobile) {
    const result = await query('SELECT * FROM users WHERE mobile=$1 AND is_blocked=FALSE', [mobile]);
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const tokens = generateTokens({ id: user.id, role: 'citizen', mobile: user.mobile });
    return res.json({ success: true, role: 'citizen', user, ...tokens });
  }

  res.status(400).json({ success: false, message: 'Provide username or mobile' });
});

// Refresh JWT
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const { iat, exp, ...payload } = decoded;
    const tokens = generateTokens(payload);
    res.json({ success: true, ...tokens });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
});

module.exports = { sendOtp, verifyOtp, register, login, refresh };
