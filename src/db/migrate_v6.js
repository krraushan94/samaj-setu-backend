require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v6 — in-person office visit requests. A citizen asks to visit the
// office (reason, party size, contact details); the admin reviews and assigns
// an actual date/time. Storing aadhar_number here again carries the same
// Aadhaar Act, 2016 legal caveat already noted in migrate_v5.js — implemented
// per explicit request.
const migration = `
  CREATE TABLE IF NOT EXISTS office_visits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    visitor_name      VARCHAR(100) NOT NULL,
    aadhar_number     VARCHAR(20),
    contact_mobile    VARCHAR(15) NOT NULL,
    address           TEXT NOT NULL,
    reason            TEXT NOT NULL,
    number_of_persons INTEGER NOT NULL DEFAULT 1,
    preferred_date    VARCHAR(50),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','completed','cancelled')),
    scheduled_time    VARCHAR(100),
    admin_note        TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_office_visits_user   ON office_visits(user_id);
  CREATE INDEX IF NOT EXISTS idx_office_visits_status ON office_visits(status);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v6 applied successfully');
  } catch (err) {
    console.error('❌ Migration v6 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
