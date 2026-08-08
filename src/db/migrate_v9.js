require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v9 — self-service password change/reset for every role. Team
// leaders/members were only ever given a username+password by whoever created
// them, with no email or mobile on file — add both, plus password_set_at
// (NULL until they've changed the admin-issued password themselves, which is
// what forces the one-time "complete your account" step in the app).
// password_resets gains a nullable `email` column so it can carry either an
// admin username (existing /auth/admin/* flow, untouched) or an email address
// (new universal flow) without breaking the existing admin-web integration.
const migration = `
  ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email           VARCHAR(100);
  ALTER TABLE team_members ADD COLUMN IF NOT EXISTS mobile          VARCHAR(15);
  ALTER TABLE team_members ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

  ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS email VARCHAR(150);
  ALTER TABLE password_resets ALTER COLUMN username DROP NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_team_members_mobile   ON team_members(mobile);
  CREATE INDEX IF NOT EXISTS idx_team_members_email    ON team_members(email);
  CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v9 applied successfully');
  } catch (err) {
    console.error('❌ Migration v9 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
