/**
 * Real in-memory Postgres-compatible DB (pg-mem) for E2E/stress tests — runs the
 * actual migration files and actual controller SQL, unlike the sequential
 * jest.fn() mocks in dbMock.js used by the per-module unit tests. Never touches
 * the real Neon/Render database.
 */
const { newDb, DataType } = require('pg-mem');
const { randomUUID } = require('crypto');

// pg-mem's SQL parser can't read precision/scale on DECIMAL/NUMERIC columns (a pg-mem
// limitation, not a bug in our migrations) — strip it only for this in-memory harness;
// real Postgres (Render/Neon) still receives the unmodified DDL from the migration files.
function stripUnsupportedSql(text) {
  return typeof text === 'string' ? text.replace(/DECIMAL\(\d+,\s*\d+\)/gi, 'NUMERIC') : text;
}

const db = newDb();

// pg-mem ships very few native SQL functions — register the handful our migrations
// and controllers actually call.
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

const pool = {
  query: (text, params) => rawPool.query(stripUnsupportedSql(text), params),
  end: async () => {},
  on: () => {},
};

const MIGRATION_FILES = ['migrate', 'migrate_v2', 'migrate_v3', 'migrate_v4', 'migrate_v5', 'migrate_v6', 'migrate_v7', 'migrate_v8', 'migrate_v9', 'migrate_v10', 'migrate_v11'];

// Builds the full real schema (via the real migration files) and seeds it (via the
// real seed.js) exactly once. Must run inside beforeAll, after jest.mock('../src/config/db', ...)
// has swapped in this module — the migration files require('../config/db') themselves,
// so they resolve to this same pool.
async function migrateAll() {
  for (const f of MIGRATION_FILES) {
    await require(`../../src/db/${f}`)();
    if (f === 'migrate_v7') {
      // migrate_v7 drops the notifications->users FK by its real-Postgres auto-generated
      // name (notifications_user_id_fkey). pg-mem names the same auto FK differently
      // (notifications_user_id_fk), so that DROP silently no-ops here (IF EXISTS) and the
      // FK would incorrectly still reject notifications for team_members ids. Drop it
      // under pg-mem's name too — a harness-only compatibility fix, not a schema change.
      await pool.query('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fk');
    }
  }
  await require('../../src/db/seed')();
}

const dbMockFactory = () => ({ query: pool.query, pool });

module.exports = { pool, query: pool.query, migrateAll, dbMockFactory, db };
