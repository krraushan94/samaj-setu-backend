const { Pool } = require('pg');

// Any remote Postgres host (Render, Neon, Supabase, ...) needs SSL; local dev doesn't
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !isLocal
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL client error', err));

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
