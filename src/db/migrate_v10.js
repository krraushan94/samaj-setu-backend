require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v10 — BMS (labour) tickets need worker-identity context that no other category
// does (identity proof, employer/organisation, sector, etc.). Rather than adding a dozen
// mostly-NULL columns to every ticket for a detail set only one category ever uses, it's
// stored as a single JSONB column populated only when category='labour'.
const migration = `
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS labour_details JSONB;
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v10 applied successfully');
  } catch (err) {
    console.error('❌ Migration v10 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
