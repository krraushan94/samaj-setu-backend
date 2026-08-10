const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID: uuidv4 } = require('crypto');
const { query } = require('../../config/db');
const { ADMIN_USERNAME } = require('../../config/constants');
const { asyncHandler } = require('../../middleware/errorHandler');
const { sendMail } = require('../../config/mailer');
const { sendOtpSms } = require('../../config/sms');

const generateTokens = (payload) => ({
  accessToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  refreshToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }),
});

// Send OTP — stores hashed OTP, then relays it via Fast2SMS. This is a brand-new
// registration step (no existing account to protect the privacy of), so unlike
// the forgot-password flows below, a genuine delivery failure is reported back
// to the caller directly rather than swallowed — silently saying "sent" when it
// wasn't just leaves the citizen stuck on the next screen with no code to enter.
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

  const { delivered, reason } = await sendOtpSms(mobile, otp);
  // In production, "not configured" is itself a failure worth surfacing loudly rather
  // than silently pretending to succeed — that's exactly how this went unnoticed before.
  // Locally, with no Fast2SMS credentials at all, the console-logged OTP fallback is fine.
  const shouldFail = !delivered && (reason !== 'not_configured' || process.env.NODE_ENV === 'production');
  if (shouldFail) {
    return res.status(502).json({ success: false, message: 'Could not send the OTP right now. Please try again in a moment.' });
  }

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
  const userResult = await query('SELECT id FROM users WHERE mobile=$1', [mobile]);
  const user = userResult.rows[0];

  if (user) {
    // OTP is a one-time registration step, not a repeat login method — an
    // already-registered mobile does NOT get logged in here (that used to
    // silently bypass the password entirely, burning an SMS on every login).
    // Returning users log in with username/mobile + password; if they forgot
    // it, /auth/citizen/reset-password is the (also OTP-gated, but rare) path back in.
    return res.json({ success: true, isNewUser: false, alreadyRegistered: true });
  }
  // New user — return temp token for registration completion
  const tempToken = jwt.sign({ mobile, role: 'pending' }, process.env.JWT_SECRET, { expiresIn: '30m' });
  res.json({ success: true, isNewUser: true, tempToken });
});

// Complete registration
const register = asyncHandler(async (req, res) => {
  const { tempToken, firstName, lastName, email, gender, ageGroup, pincode, mandal, ward, colony, voterIdNumber, aadharNumber, password, isCaregiverSignup, caregiverName, caregiverMobile } = req.body;
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
  // tickets to the right local team — required. A password is mandatory too:
  // OTP is meant to be a one-time registration step, not a repeat login method
  // (each OTP costs real SMS credit), so every account needs a way to log back
  // in without one. At least one of Aadhaar/Voter ID is required as an
  // identity signal (Aadhaar collection carries real legal exposure under the
  // Aadhaar Act, 2016 — implemented per explicit request despite that caveat).
  if (!firstName?.trim() || !lastName?.trim()) {
    return res.status(400).json({ success: false, message: 'First and last name are required' });
  }
  if (!pincode?.trim() || !ward?.trim() || !colony?.trim()) {
    return res.status(400).json({ success: false, message: 'Pincode, ward and area/colony are required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: 'A password of at least 8 characters is required' });
  }
  if (!aadharNumber?.trim() && !voterIdNumber?.trim()) {
    return res.status(400).json({ success: false, message: 'Aadhaar number or Voter ID is required' });
  }

  const existing = await query('SELECT id FROM users WHERE mobile=$1', [decoded.mobile]);
  if (existing.rows.length) {
    return res.status(409).json({ success: false, message: 'User already registered' });
  }

  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO users (id, first_name, last_name, full_name, mobile, email, gender, age_group, pincode, mandal, ward, colony, voter_id_number, aadhar_number, password_hash, is_verified, caregiver_name, caregiver_mobile)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,$16,$17) RETURNING *`,
    [uuidv4(), firstName.trim(), lastName.trim(), fullName, decoded.mobile, email || null, gender || null, ageGroup || null,
     pincode.trim(), mandal || null, ward.trim(), colony.trim(), voterIdNumber || null, aadharNumber || null, passwordHash,
     isCaregiverSignup ? (caregiverName || null) : null, isCaregiverSignup ? (caregiverMobile || null) : null]
  );
  const { password_hash, ...safeUser } = result.rows[0];
  const tokens = generateTokens({ id: safeUser.id, role: 'citizen', mobile: safeUser.mobile });
  res.status(201).json({ success: true, ...tokens, user: safeUser });
});

// Citizen password reset — the only place OTP is used again after initial
// registration, and only when a citizen genuinely forgot their password.
const resetCitizenPassword = asyncHandler(async (req, res) => {
  const { mobile, otp, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'A password of at least 8 characters is required' });
  }
  const result = await query(
    'SELECT * FROM otp_verifications WHERE mobile=$1 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [mobile]
  );
  if (!result.rows.length) return res.status(400).json({ success: false, message: 'OTP expired or not found' });
  const record = result.rows[0];
  const valid = await bcrypt.compare(otp, record.otp_hash);
  if (!valid) return res.status(400).json({ success: false, message: 'Invalid OTP' });
  await query('UPDATE otp_verifications SET used=TRUE WHERE id=$1', [record.id]);

  const userResult = await query('SELECT * FROM users WHERE mobile=$1', [mobile]);
  if (!userResult.rows.length) return res.status(404).json({ success: false, message: 'No account found for this mobile number' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash=$1 WHERE mobile=$2', [passwordHash, mobile]);

  const { password_hash, ...safeUser } = userResult.rows[0];
  const tokens = generateTokens({ id: safeUser.id, role: 'citizen', mobile: safeUser.mobile });
  res.json({ success: true, ...tokens, user: safeUser });
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

// Change password while logged in (any role) — requires knowing the current
// password. Team leaders/members were only ever given a username+password by
// whoever created them, with no email/mobile on file, so the FIRST time one of
// them changes it, email + mobile become mandatory here and get saved — that's
// what lets forgotPassword/confirmPasswordReset below work for them afterward.
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, email, mobile } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
  }
  const { role } = req.user;

  if (role === 'citizen') {
    const result = await query('SELECT id, password_hash FROM users WHERE id=$1', [req.user.id]);
    const user = result.rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(currentPassword || '', user.password_hash))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
    return res.json({ success: true, message: 'Password updated' });
  }

  if (role === 'leader' || role === 'member') {
    const result = await query('SELECT * FROM team_members WHERE id=$1', [req.user.id]);
    const member = result.rows[0];
    if (!member || !(await bcrypt.compare(currentPassword || '', member.password_hash))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    if (!member.password_set_at) {
      const trimmedEmail = email?.trim();
      const trimmedMobile = mobile?.trim();
      if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
        return res.status(400).json({ success: false, message: 'A valid email is required the first time you change your password' });
      }
      if (!trimmedMobile || !/^\d{10}$/.test(trimmedMobile)) {
        return res.status(400).json({ success: false, message: 'A valid 10-digit mobile number is required the first time you change your password' });
      }
      await query(
        'UPDATE team_members SET password_hash=$1, email=$2, mobile=$3, password_set_at=NOW() WHERE id=$4',
        [hash, trimmedEmail, trimmedMobile, member.id]
      );
      return res.json({ success: true, message: 'Password and contact details saved' });
    }
    await query('UPDATE team_members SET password_hash=$1 WHERE id=$2', [hash, member.id]);
    return res.json({ success: true, message: 'Password updated' });
  }

  if (role === 'admin') {
    const result = await query('SELECT * FROM admin_users WHERE username=$1', [req.user.username]);
    const admin = result.rows[0];
    if (admin) {
      if (!(await bcrypt.compare(currentPassword || '', admin.password_hash))) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE username=$2', [hash, req.user.username]);
      return res.json({ success: true, message: 'Password updated' });
    }
    // No DB row yet (pre-bootstrap edge case) — fall back to the env hash, same as login's admin branch
    if (req.user.username === ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH) {
      if (!(await bcrypt.compare(currentPassword || '', process.env.ADMIN_PASSWORD_HASH))) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
      const hash = await bcrypt.hash(newPassword, 12);
      await query(
        `INSERT INTO admin_users (username, full_name, email, password_hash, created_by) VALUES ($1,'Raushan Kumar',$2,$3,'system')
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [ADMIN_USERNAME, process.env.ADMIN_EMAIL || 'sihsraushandc@gmail.com', hash]
      );
      return res.json({ success: true, message: 'Password updated' });
    }
    return res.status(404).json({ success: false, message: 'Admin account not found' });
  }

  res.status(403).json({ success: false, message: 'Unsupported account type' });
});

// Forgot password (any role) — identifier is either a mobile number or an email
// address, auto-detected. Reuses the same OTP-via-SMS path as registration for
// a mobile, and a bcrypt-hashed emailed code (same pattern as forgotAdminPassword)
// for an email. Always responds generically so this can't be used to probe which
// mobiles/emails have accounts — and for a mobile, an SMS is only ever sent when
// it actually matches an account, unlike /auth/send-otp (used for brand-new
// registration, where no account exists yet to check against).
const requestPasswordReset = asyncHandler(async (req, res) => {
  const value = (req.body.identifier || '').trim();
  const isMobile = /^\d{10}$/.test(value);
  const isEmail = /^\S+@\S+\.\S+$/.test(value);
  if (!isMobile && !isEmail) {
    return res.status(400).json({ success: false, message: 'Enter a valid 10-digit mobile number or email address' });
  }

  if (isMobile) {
    const [citizen, member] = await Promise.all([
      query('SELECT id FROM users WHERE mobile=$1', [value]),
      query('SELECT id FROM team_members WHERE mobile=$1', [value]),
    ]);
    if (citizen.rows.length || member.rows.length) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await query('INSERT INTO otp_verifications (id, mobile, otp_hash, expires_at) VALUES ($1,$2,$3,$4)', [uuidv4(), value, otpHash, expiresAt]);
      await sendOtpSms(value, otp);
    }
  } else {
    const [citizen, member, admin] = await Promise.all([
      query('SELECT id FROM users WHERE email=$1', [value]),
      query('SELECT id FROM team_members WHERE email=$1', [value]),
      query('SELECT username FROM admin_users WHERE email=$1', [value]),
    ]);
    if (citizen.rows.length || member.rows.length || admin.rows.length) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await query('INSERT INTO password_resets (id, email, code_hash, expires_at) VALUES ($1,$2,$3,$4)', [uuidv4(), value, codeHash, expiresAt]);
      await sendMail({
        to: value, subject: 'Samaj Setu — password reset code',
        text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this email.`,
      });
    }
  }

  res.json({ success: true, message: 'If that account exists, a reset code has been sent.' });
});

// Confirm forgot-password (any role) — verifies the OTP (mobile) or emailed code
// (email), then finds and updates whichever account actually matches: citizen,
// team member, or admin. A team member resetting this way counts as their
// first password change too (password_set_at gets stamped) if it wasn't already.
const confirmPasswordReset = asyncHandler(async (req, res) => {
  const value = (req.body.identifier || '').trim();
  const { code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
  }
  const isMobile = /^\d{10}$/.test(value);

  let record;
  if (isMobile) {
    const result = await query(
      'SELECT * FROM otp_verifications WHERE mobile=$1 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [value]
    );
    record = result.rows[0];
    if (!record || !(await bcrypt.compare(code || '', record.otp_hash))) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }
    await query('UPDATE otp_verifications SET used=TRUE WHERE id=$1', [record.id]);
  } else {
    const result = await query(
      'SELECT * FROM password_resets WHERE email=$1 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [value]
    );
    record = result.rows[0];
    if (!record || !(await bcrypt.compare(code || '', record.code_hash))) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }
    await query('UPDATE password_resets SET used=TRUE WHERE id=$1', [record.id]);
  }

  const hash = await bcrypt.hash(newPassword, 12);
  const column = isMobile ? 'mobile' : 'email'; // hardcoded to one of these two literals only — never user input

  const citizen = await query(`SELECT id FROM users WHERE ${column}=$1`, [value]);
  if (citizen.rows.length) {
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, citizen.rows[0].id]);
    const tokens = generateTokens({ id: citizen.rows[0].id, role: 'citizen', mobile: isMobile ? value : undefined });
    return res.json({ success: true, role: 'citizen', ...tokens });
  }

  const member = await query(`SELECT * FROM team_members WHERE ${column}=$1`, [value]);
  if (member.rows.length) {
    await query('UPDATE team_members SET password_hash=$1, password_set_at=NOW() WHERE id=$2', [hash, member.rows[0].id]);
    const tokens = generateTokens({ id: member.rows[0].id, role: member.rows[0].role, departmentId: member.rows[0].department_id, username: member.rows[0].username });
    return res.json({ success: true, role: member.rows[0].role, ...tokens });
  }

  if (!isMobile) {
    const admin = await query('SELECT username FROM admin_users WHERE email=$1', [value]);
    if (admin.rows.length) {
      await query('UPDATE admin_users SET password_hash=$1, updated_at=NOW() WHERE username=$2', [hash, admin.rows[0].username]);
      const tokens = generateTokens({ id: admin.rows[0].username, role: 'admin', username: admin.rows[0].username });
      return res.json({ success: true, role: 'admin', ...tokens });
    }
  }

  res.status(404).json({ success: false, message: 'No account found for that mobile number or email' });
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

module.exports = {
  sendOtp, verifyOtp, register, login, refresh, forgotAdminPassword, resetAdminPassword, resetCitizenPassword,
  changePassword, requestPasswordReset, confirmPasswordReset,
};
