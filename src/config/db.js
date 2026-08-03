const { Pool } = require('pg');

// Render internal connections don't need SSL; external ones do
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('.render.com')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL client error', err));

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
