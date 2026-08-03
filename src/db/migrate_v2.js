require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v2 — adds admin_users, app_settings, issue_categories tables
const migration = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  -- Secondary admin accounts (only Admin_Raushan can create)
  CREATE TABLE IF NOT EXISTS admin_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50) UNIQUE NOT NULL,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(150),
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN DEFAULT TRUE,
    created_by    VARCHAR(50) DEFAULT 'Admin_Raushan',
    last_login    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- App-wide settings (key-value store admin can edit)
  CREATE TABLE IF NOT EXISTS app_settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT NOT NULL,
    label      VARCHAR(200),
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Dynamic issue categories (admin can CRUD)
  CREATE TABLE IF NOT EXISTS issue_categories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key          VARCHAR(50) UNIQUE NOT NULL,
    label        VARCHAR(100) NOT NULL,
    icon         VARCHAR(50) DEFAULT 'help',
    color        VARCHAR(20) DEFAULT '#9E9E9E',
    department   VARCHAR(50),
    is_active    BOOLEAN DEFAULT TRUE,
    sort_order   INT DEFAULT 100,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- Sub-categories under each category
  CREATE TABLE IF NOT EXISTS issue_sub_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key VARCHAR(50) NOT NULL,
    label       VARCHAR(100) NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    sort_order  INT DEFAULT 100,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Announcements / broadcasts (admin can CRUD)
  CREATE TABLE IF NOT EXISTS announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(255) NOT NULL,
    body        TEXT NOT NULL,
    target      VARCHAR(20) DEFAULT 'all',
    ward        VARCHAR(50),
    is_pinned   BOOLEAN DEFAULT FALSE,
    created_by  VARCHAR(100),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Add email to admin_users for Admin_Raushan profile
  ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone VARCHAR(15);

  CREATE INDEX IF NOT EXISTS idx_admin_users_username  ON admin_users(username);
  CREATE INDEX IF NOT EXISTS idx_issue_categories_key  ON issue_categories(key);
  CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v2 applied successfully');
  } catch (err) {
    console.error('❌ Migration v2 failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
