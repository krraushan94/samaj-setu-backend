require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');
const { ADMIN_USERNAME } = require('../config/constants');

// Migration v3 — community board moderation (report/hide), caregiver contact fields,
// password-reset support table
const migration = `
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_hidden_from_board BOOLEAN DEFAULT FALSE;
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

  CREATE TABLE IF NOT EXISTS post_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id         UUID REFERENCES tickets(id) ON DELETE CASCADE,
    reporter_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    reason            TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS caregiver_name   VARCHAR(100);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS caregiver_mobile VARCHAR(15);

  CREATE TABLE IF NOT EXISTS password_resets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50) NOT NULL,
    code_hash     VARCHAR(255) NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    used          BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_post_reports_ticket ON post_reports(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_hidden      ON tickets(is_hidden_from_board);
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(username);
`;

// One-time password set — applies the admin password exactly once from ADMIN_PASSWORD_HASH,
// guarded by an app_settings flag so it never clobbers a password Admin_Raushan has since
// changed via the app. The plaintext password never lives in source — only its bcrypt hash,
// supplied via env var, is ever referenced here.
const ADMIN_PASSWORD_FLAG = 'admin_password_2026_applied';

async function applyConfirmedAdminPasswordOnce() {
  const flag = await pool.query('SELECT 1 FROM app_settings WHERE key=$1', [ADMIN_PASSWORD_FLAG]);
  if (flag.rows.length) return; // already applied — never overwrite a later manual change

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    console.warn('⚠️  ADMIN_PASSWORD_HASH not set — skipping one-time admin password bootstrap.');
    return;
  }
  await pool.query(
    `INSERT INTO admin_users (username, full_name, email, password_hash, created_by)
     VALUES ($1, 'Raushan Kumar', 'sihsraushandc@gmail.com', $2, 'system')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email`,
    [ADMIN_USERNAME, hash]
  );
  await pool.query(
    `INSERT INTO app_settings (key, value, label, updated_by) VALUES ($1, 'true', 'Admin password set (one-time, 2026)', 'system')
     ON CONFLICT (key) DO NOTHING`,
    [ADMIN_PASSWORD_FLAG]
  );
  console.log(`✅ ${ADMIN_USERNAME} password bootstrapped from ADMIN_PASSWORD_HASH (one-time — future changes via the app are preserved)`);
}

async function migrate() {
  try {
    await pool.query(migration);
    await applyConfirmedAdminPasswordOnce();
    console.log('✅ Migration v3 applied successfully');
  } catch (err) {
    console.error('❌ Migration v3 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
