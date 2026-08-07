const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { ADMIN_USERNAME } = require('../../config/constants');
const { asyncHandler } = require('../../middleware/errorHandler');
const { sendMail } = require('../../config/mailer');

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
    const { password_hash, ...safeUser } = user;
    const tokens = generateTokens({ id: user.id, role: 'citizen', mobile: user.mobile });
    return res.json({ success: true, isNewUser: false, ...tokens, user: safeUser });
  }
  // New user — return temp token for registration completion
  const tempToken = jwt.sign({ mobile, role: 'pending' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  res.json({ success: true, isNewUser: true, tempToken });
});

// Complete registration
const register = asyncHandler(async (req, res) => {
  const { tempToken, firstName, lastName, email, gender, ageGroup, pincode, mandal, ward, colony, voterIdNumber, password, isCaregiverSignup, caregiverName, caregiverMobile } = req.body;
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid registration session' });
  }
  if (decoded.role !== 'pending') {
    return res.status(400).json({ success: false, message: 'Invalid token type' });
  }

  // First/last name, ward, area and pincode identify who is reporting and route
  // tickets to the right local team — required. Voter ID is a lighter-weight,
  // legally safer identity signal than Aadhaar (see migrate_v4.js) and stays optional.
  if (!firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ success: false, message: 'First and last name are required' });
  }
  if (!pincode?.trim() || !ward?.trim() || !colony?.trim()) {
    return res.status(400).json({ success: false, message: 'Pincode, ward and area/colony are required' });
  }

  const existing = await query('SELECT id FROM users WHERE mobile=$1', [decoded.mobile]);
  if (existing.rows.length) {
    return res.status(409).json({ success: false, message: 'User already registered' });
  }

  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const result = await query(
    `INSERT INTO users (id, first_name, last_name, full_name, mobile, email, gender, age_group, pincode, mandal, ward, colony, voter_id_number, password_hash, is_verified, caregiver_name, caregiver_mobile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16) RETURNING *`,
    [uuidv4(), firstName.trim(), lastName.trim(), fullName, decoded.mobile, email || null, gender || null, ageGroup || null,
     pincode.trim(), mandal || null, ward.trim(), colony.trim(), voterIdNumber || null, passwordHash,
     isCaregiverSignup ? (caregiverName || null) : null, isCaregiverSignup ? (caregiverMobile || null) : null]
  );
  const { password_hash, ...safeUser } = result.rows[0];
  const tokens = generateTokens({ id: safeUser.id, role: 'citizen', mobile: safeUser.mobile });
  res.status(201).json({ success: true, ...tokens, user: safeUser });
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
    const { password_hash, ...safeMember } = member;
    const tokens = generateTokens({ id: member.id, role: member.role, departmentId: member.department_id, username });
    return res.json({ success: true, role: member.role, member: safeMember, ...tokens });
  }

  // Citizen password login
  if (mobile) {
    const result = await query('SELECT * FROM users WHERE mobile=$1 AND is_blocked=FALSE', [mobile]);
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const { password_hash, ...safeUser } = user;
    const tokens = generateTokens({ id: user.id, role: 'citizen', mobile: user.mobile });
    return res.json({ success: true, role: 'citizen', user: safeUser, ...tokens });
  }

  res.status(400).json({ success: false, message: 'Provide username or mobile' });
});

// Admin forgot password — only ever for Admin_Raushan, emails a 6-digit code to the
// registered recovery address (never returned in the API response).
const forgotAdminPassword = asyncHandler(async (req, res) => {
  const { username } = req.body;
  if (username !== ADMIN_USERNAME) {
    // Same generic response either way — don't reveal which usernames are valid admins
    return res.json({ success: true, message: 'If that account exists, a reset code has been sent.' });
  }

  const admin = await query('SELECT email FROM admin_users WHERE username=$1', [ADMIN_USERNAME]);
  const email = admin.rows[0]?.email || process.env.ADMIN_EMAIL || 'sihsraushandc@gmail.com';

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await query(
    'INSERT INTO password_resets (id, username, code_hash, expires_at) VALUES ($1,$2,$3,$4)',
    [uuidv4(), ADMIN_USERNAME, codeHash, expiresAt]
  );

  await sendMail({
    to: email,
    subject: 'Samaj Setu — Admin password reset code',
    text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this email.`,
  });

  res.json({ success: true, message: 'If that account exists, a reset code has been sent.' });
});

// Admin reset password — verifies the emailed code, sets the new password
const resetAdminPassword = asyncHandler(async (req, res) => {
  const { username, code, newPassword } = req.body;
  if (username !== ADMIN_USERNAME) return res.status(400).json({ success: false, message: 'Invalid request' });
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }

  const result = await query(
    'SELECT * FROM password_resets WHERE username=$1 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [username]
  );
  if (!result.rows.length) return res.status(400).json({ success: false, message: 'Reset code expired or not found' });

  const record = result.rows[0];
  const valid = await bcrypt.compare(code, record.code_hash);
  if (!valid) return res.status(400).json({ success: false, message: 'Invalid reset code' });

  await query('UPDATE password_resets SET used=TRUE WHERE id=$1', [record.id]);

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE username=$2', [hash, username]);

  res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
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

module.exports = { sendOtp, verifyOtp, register, login, refresh, forgotAdminPassword, resetAdminPassword };
