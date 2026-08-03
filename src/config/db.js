const { Pool } = require('pg');

// SSL required for Render managed PostgreSQL external connections
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false, require: true } : false,
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL client error', err));

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
