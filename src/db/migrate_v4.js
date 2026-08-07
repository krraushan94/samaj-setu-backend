require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v4 — split full_name into first/last name, add optional Voter ID (EPIC)
// for identity verification. Deliberately NOT collecting Aadhaar numbers: the
// Aadhaar Act, 2016 (Sections 8/29) restricts private entities from collecting or
// storing Aadhaar numbers outside UIDAI-authorized flows, so Voter ID is the safer
// identity signal for a citizen-reporting app. full_name is kept (backfilled from
// first+last) since other queries across the codebase still read it directly.
const migration = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name      VARCHAR(50);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name       VARCHAR(50);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS voter_id_number VARCHAR(20);

  UPDATE users SET first_name = split_part(full_name, ' ', 1) WHERE first_name IS NULL;
  UPDATE users SET last_name  = trim(substring(full_name FROM length(split_part(full_name, ' ', 1)) + 1))
    WHERE last_name IS NULL AND full_name LIKE '% %';
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v4 applied successfully');
  } catch (err) {
    console.error('❌ Migration v4 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
