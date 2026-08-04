require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');
const { DEPARTMENTS, ADMIN_USERNAME, ISSUE_CATEGORIES } = require('../config/constants');

const ADMIN_EMAIL = 'sihsraushandc@gmail.com';

async function seed() {
  try {
    // Seed departments
    for (const name of DEPARTMENTS) {
      await pool.query(
        'INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
      );
    }
    console.log('✅ Departments seeded');

    // Seed issue categories
    for (const [key, subs] of Object.entries(ISSUE_CATEGORIES)) {
      await pool.query(
        `INSERT INTO issue_categories (key, label, department, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label`,
        [key, key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 'Social Welfare']
      ).catch(() => {}); // table may not exist yet on first run
      for (const sub of subs) {
        await pool.query(
          `INSERT INTO issue_sub_categories (category_key, label) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [key, sub]
        ).catch(() => {});
      }
    }
    console.log('✅ Issue categories seeded');

    // Seed default app settings
    const DEFAULTS = [
      ['app_name',          'Samaj Setu',                         'App Name'],
      ['office_address',    'RAM Mandir New Town Hatiara, Kolkata','Office Address'],
      ['office_phone',      '',                                    'Office Phone'],
      ['ticket_fee',        '50',                                  'Ticket Fee (₹)'],
      ['online_payment',    'false',                               'Online Payment Enabled'],
      ['sos_alert_email',   ADMIN_EMAIL,                          'SOS Alert Email'],
      ['escalation_hours',  '72',                                  'Auto-escalation Hours'],
      ['max_upvote_escalate','5',                                  'Upvotes to Auto-escalate'],
    ];
    for (const [key, value, label] of DEFAULTS) {
      await pool.query(
        `INSERT INTO app_settings (key, value, label, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO NOTHING`,
        [key, value, label, ADMIN_USERNAME]
      ).catch(() => {});
    }
    console.log('✅ App settings seeded');

    // Seed Admin_Raushan profile in admin_users — password comes only from the
    // pre-hashed ADMIN_PASSWORD_HASH env var, never a plaintext literal in source.
    if (process.env.ADMIN_PASSWORD_HASH) {
      await pool.query(
        `INSERT INTO admin_users (username, full_name, email, password_hash, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO UPDATE SET email=EXCLUDED.email`,
        [ADMIN_USERNAME, 'Raushan Kumar', ADMIN_EMAIL, process.env.ADMIN_PASSWORD_HASH, 'system']
      ).catch(() => {});
      console.log(`✅ Admin account ready: ${ADMIN_USERNAME} / email: ${ADMIN_EMAIL}`);
    } else {
      console.warn('⚠️  ADMIN_PASSWORD_HASH not set — skipping admin credential seed. Set it in your environment to bootstrap the admin account.');
    }

    console.log('✅ Seed v2 completed');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) seed();
module.exports = seed;
