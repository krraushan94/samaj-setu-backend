/**
 * Concurrency / load smoke test — hammers a real running instance of the app
 * (real Express app, real middleware, real rate limiters) backed by the same
 * in-memory pg-mem database used by __tests__/e2e.flow.test.js. Never touches
 * the real Neon/Render database. Run with: node scripts/stressTest.js
 */
const path = require('path');
const autocannon = require('autocannon');
const bcrypt = require('bcryptjs');

const ADMIN_PLAINTEXT_PASSWORD = 'Stress-Test-Admin-Pass-1';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PLAINTEXT_PASSWORD, 10);
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin_Raushan';
process.env.PORT = process.env.STRESS_TEST_PORT || '5901';
process.env.NODE_ENV = 'test'; // skip app.js's production migration path — we run migrations ourselves below

// ── Same pg-mem harness as the e2e test, but wired by hand since there's no
// jest.mock magic outside Jest — monkeypatch the module cache before anything
// requires ../src/config/db.
const { newDb, DataType } = require('pg-mem');
const { randomUUID } = require('crypto');

function stripUnsupportedSql(text) {
  return typeof text === 'string' ? text.replace(/DECIMAL\(\d+,\s*\d+\)/gi, 'NUMERIC') : text;
}

const db = newDb();
const registerCompat = (schema) => {
  schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: () => randomUUID(), impure: true });
  schema.registerFunction({
    name: 'split_part', args: [DataType.text, DataType.text, DataType.integer], returns: DataType.text,
    implementation: (str, delim, idx) => (str ?? '').split(delim)[idx - 1] ?? '',
  });
  schema.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (str) => (str ?? '').length });
  schema.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (str) => (str ?? '').trim() });
};
registerCompat(db.public);
db.registerExtension('pgcrypto', registerCompat);

const { Pool } = db.adapters.createPg();
const rawPool = new Pool();
const pool = { query: (text, params) => rawPool.query(stripUnsupportedSql(text), params), end: async () => {}, on: () => {} };

const dbModulePath = path.join(__dirname, '../src/config/db.js');
require.cache[require.resolve(dbModulePath)] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: { query: pool.query, pool },
};

async function migrateAll() {
  const files = ['migrate', 'migrate_v2', 'migrate_v3', 'migrate_v4', 'migrate_v5', 'migrate_v6', 'migrate_v7', 'migrate_v8', 'migrate_v9'];
  for (const f of files) {
    await require(path.join(__dirname, `../src/db/${f}.js`))();
    if (f === 'migrate_v7') {
      // see __tests__/helpers/pgMemDb.js for why this extra drop is needed under pg-mem
      await pool.query('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fk');
    }
  }
  await require(path.join(__dirname, '../src/db/seed.js'))();
}

function fmt(result) {
  return {
    url: result.url,
    requests: result.requests.total,
    errors: result.errors,
    '2xx': result['2xx'],
    '401': result.statusCodeStats['401']?.count || 0,
    '429': result.statusCodeStats['429']?.count || 0,
    '5xx': result['5xx'],
    latencyMs: { p50: result.latency.p50, p99: result.latency.p99, max: result.latency.max },
    throughputReqSec: result.requests.average,
  };
}

async function main() {
  await migrateAll();
  const app = require(path.join(__dirname, '../src/app.js'));
  await new Promise((resolve) => setTimeout(resolve, 300)); // let app.listen() settle
  // 127.0.0.1, not "localhost" — avoids autocannon's connections resolving to a mix of the
  // IPv4/IPv6 loopback addresses, which would split one client across two rate-limit keys.
  const base = `http://127.0.0.1:${process.env.PORT}`;

  // Seed one real citizen + the bootstrapped admin so authenticated endpoints have something real to hit.
  const bcryptHash = await bcrypt.hash('Citizen@StressPass1', 10);
  const citizen = await pool.query(
    `INSERT INTO users (id, first_name, last_name, full_name, mobile, pincode, ward, colony, password_hash, is_verified)
     VALUES (gen_random_uuid(), 'Stress', 'User', 'Stress User', '9800022222', '700157', 'Ward 1', 'Hatiara', $1, TRUE) RETURNING id`,
    [bcryptHash],
  );
  const jwt = require('jsonwebtoken');
  const citizenToken = jwt.sign({ id: citizen.rows[0].id, role: 'citizen', mobile: '9800022222' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  console.log(`\n=== Stress test target: ${base} (in-memory DB, ${process.env.NODE_ENV} env) ===\n`);
  console.log('Every request here shares ONE global budget too: app.js applies a blanket 200');
  console.log('req/15min-per-IP limiter ahead of every route. So the route-specific limiters');
  console.log('(login: 8/15min, OTP: 3/10min) are tested FIRST, before that shared budget is');
  console.log('anywhere near spent — otherwise a 429 could just mean "global cap hit", not');
  console.log('"the specific limiter under test actually engaged".\n');

  console.log('--- 1) POST /api/auth/send-otp (same mobile, wrong-password-equivalent burst) — verifying otpLimiter (max 3/10min) — 5 connections, 12 requests ---');
  const otp = await autocannon({
    url: `${base}/api/auth/send-otp`, method: 'POST', connections: 5, amount: 12,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: '9800033333' }),
  });
  const otpResult = fmt(otp);
  console.log(JSON.stringify(otpResult, null, 2));
  console.log(otpResult['429'] > 0
    ? `✅ otpLimiter engaged: ${otpResult['429']} of ${otpResult.requests} requests were rate-limited (429) once burst traffic exceeded max=3/10min for this mobile+IP.`
    : `❌ otpLimiter did NOT engage — expected some 429s once 3 OTP sends/10min for this mobile+IP were exceeded.`);

  console.log('\n--- 2) POST /api/auth/login (wrong password, same username) — verifying loginLimiter (max 8/15min) — 6 connections, 18 requests ---');
  const login = await autocannon({
    url: `${base}/api/auth/login`, method: 'POST', connections: 6, amount: 18,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: 'wrong-password' }),
  });
  const loginResult = fmt(login);
  console.log(JSON.stringify(loginResult, null, 2));
  console.log(loginResult['429'] > 0
    ? `✅ loginLimiter engaged: ${loginResult['429']} of ${loginResult.requests} requests were rate-limited (429), and ${loginResult['401']} correctly got 401 (wrong password) before the limit was hit.`
    : `❌ loginLimiter did NOT engage — expected some 429s once 8 attempts/15min for this username+IP were exceeded.`);

  console.log('\n--- 3) GET /api/tickets (authenticated citizen) — 20 connections, 5s — expect this to run into the GLOBAL 200 req/15min/IP limiter partway through, since tests 1–2 already spent some of that shared budget ---');
  const tickets = await autocannon({
    url: `${base}/api/tickets`, connections: 20, duration: 5,
    headers: { authorization: `Bearer ${citizenToken}` },
  });
  const ticketsResult = fmt(tickets);
  console.log(JSON.stringify(ticketsResult, null, 2));
  console.log(ticketsResult['429'] > 0
    ? `✅ Global limiter engaged: ${ticketsResult['429']} of ${ticketsResult.requests} requests were rate-limited once this IP's shared 200 req/15min budget ran out — expected under sustained burst, and confirms the app survives it (no 5xx, no crash) rather than falling over.`
    : `ℹ️  Global limiter never engaged — burst stayed under the shared 200 req/15min/IP budget.`);
  console.log(ticketsResult['5xx'] === 0 ? '✅ Zero server errors under load.' : `❌ ${ticketsResult['5xx']} server errors (5xx) under load — investigate.`);

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch((err) => { console.error('Stress test crashed:', err); process.exit(1); });
