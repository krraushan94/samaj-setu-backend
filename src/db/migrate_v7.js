require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v7 — notifications can now go to a team member (SOS routed to a
// department, ticket assigned) as well as a citizen (status changed). The
// original table's user_id had a hard FK to users(id) only, which can't
// reference team_members(id) — drop it and track which table the id belongs
// to via recipient_role instead.
const migration = `
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20) NOT NULL DEFAULT 'citizen';

  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(user_id, recipient_role);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v7 applied successfully');
  } catch (err) {
    console.error('❌ Migration v7 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
