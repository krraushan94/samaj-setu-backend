require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v11 — notifications previously carried only human-readable title/body text, with
// no structured reference to what they were about. That meant tapping a notification could
// only mark it read, never navigate anywhere — a real dead end for "your ticket was resolved"
// style notifications. entity_type/entity_id let the client route a tap to the right screen.
const migration = `
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30);
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v11 applied successfully');
  } catch (err) {
    console.error('❌ Migration v11 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
