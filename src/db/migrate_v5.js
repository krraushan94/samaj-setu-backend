require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v5 — adds an Aadhaar number column alongside the existing Voter ID
// column. Registration now requires at least one of the two as an identity
// signal. Storing a raw Aadhaar number carries real legal exposure under the
// Aadhaar Act, 2016 (Sections 8/29 restrict private collection/storage outside
// UIDAI-authorized flows) — this was implemented at the app owner's explicit
// request after that caveat was raised; revisit if that changes.
const migration = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhar_number VARCHAR(20);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v5 applied successfully');
  } catch (err) {
    console.error('❌ Migration v5 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
