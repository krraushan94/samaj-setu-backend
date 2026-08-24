require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v12 — real push notifications. Every in-app notification (ticket status change,
// assignment, SOS, visit scheduled, etc.) previously only ever appeared in the Notifications
// list, invisible until the citizen/team member reopened the app. push_token stores the
// Expo push token registered by the device on login; notify.js uses it to also fire a real
// push alongside the existing in-app row. NULL until a device registers one — never required.
const migration = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
  ALTER TABLE team_members ADD COLUMN IF NOT EXISTS push_token TEXT;
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v12 applied successfully');
  } catch (err) {
    console.error('❌ Migration v12 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
