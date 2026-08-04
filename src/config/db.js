const { Pool } = require('pg');

// Render's internal DB hostnames (e.g. dpg-xxxx-a) have no dot and live on a private
// network with no SSL. Localhost dev also skips SSL. Every real external host — Render's
// own external URL, Neon, Supabase — has a dotted hostname and requires SSL.
function needsSSL(connStr) {
  if (!connStr) return false;
  try {
    const { hostname } = new URL(connStr);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    return hostname.includes('.');
  } catch {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL client error', err));

const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
