require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

const migration = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     VARCHAR(100) NOT NULL,
    mobile        VARCHAR(15) UNIQUE NOT NULL,
    email         VARCHAR(100),
    gender        VARCHAR(20),
    age_group     VARCHAR(20),
    pincode       VARCHAR(10),
    mandal        VARCHAR(100),
    ward          VARCHAR(50),
    colony        VARCHAR(100),
    password_hash VARCHAR(255),
    is_verified   BOOLEAN DEFAULT FALSE,
    is_blocked    BOOLEAN DEFAULT FALSE,
    profile_photo VARCHAR(500),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS departments (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    full_name     VARCHAR(100) NOT NULL,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('leader', 'member')),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number    VARCHAR(20) UNIQUE NOT NULL,
    user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    category         VARCHAR(50) NOT NULL,
    sub_category     VARCHAR(100) NOT NULL,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    latitude         DECIMAL(10,8),
    longitude        DECIMAL(11,8),
    location_text    VARCHAR(255),
    priority         VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
    status           VARCHAR(30) DEFAULT 'payment_pending',
    department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
    assigned_to      UUID REFERENCES team_members(id) ON DELETE SET NULL,
    is_anonymous     BOOLEAN DEFAULT FALSE,
    upvote_count     INT DEFAULT 0,
    resolution_note  TEXT,
    resolution_photo VARCHAR(500),
    citizen_rating   SMALLINT CHECK (citizen_rating BETWEEN 1 AND 5),
    citizen_feedback TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ticket_upvotes (
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, ticket_id)
  );

  CREATE TABLE IF NOT EXISTS media_attachments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID REFERENCES tickets(id) ON DELETE CASCADE,
    type       VARCHAR(10) NOT NULL CHECK (type IN ('photo','video','audio')),
    s3_key     VARCHAR(500) NOT NULL,
    s3_url     VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS payments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        UUID REFERENCES tickets(id) ON DELETE CASCADE,
    user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    reference_number VARCHAR(20) UNIQUE NOT NULL,
    amount           DECIMAL(10,2) DEFAULT 50.00,
    method           VARCHAR(20) DEFAULT 'cash',
    status           VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','refunded')),
    confirmed_by     UUID REFERENCES team_members(id) ON DELETE SET NULL,
    confirmed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ticket_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID REFERENCES tickets(id) ON DELETE CASCADE,
    changed_by VARCHAR(100),
    role       VARCHAR(20),
    old_status VARCHAR(30),
    new_status VARCHAR(30),
    note       TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   VARCHAR(100),
    actor_role VARCHAR(20),
    action     VARCHAR(100),
    entity     VARCHAR(50),
    entity_id  VARCHAR(100),
    details    JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS app_impressions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    screen      VARCHAR(100),
    action      VARCHAR(100),
    session_id  VARCHAR(100),
    device_info JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    event_date  TIMESTAMPTZ,
    location    VARCHAR(255),
    created_by  VARCHAR(100),
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS missing_persons (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reported_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    name         VARCHAR(100) NOT NULL,
    age          SMALLINT,
    gender       VARCHAR(20),
    photo_url    VARCHAR(500),
    last_seen    VARCHAR(255),
    description  TEXT,
    contact      VARCHAR(15),
    status       VARCHAR(20) DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(255),
    body       TEXT,
    type       VARCHAR(50),
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS otp_verifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile     VARCHAR(15) NOT NULL,
    otp_hash   VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Indexes for common query patterns
  CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_tickets_priority    ON tickets(priority);
  CREATE INDEX IF NOT EXISTS idx_tickets_user_id     ON tickets(user_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_dept        ON tickets(department_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON audit_logs(actor_id);
  CREATE INDEX IF NOT EXISTS idx_impressions_user    ON app_impressions(user_id);
  CREATE INDEX IF NOT EXISTS idx_impressions_screen  ON app_impressions(screen);
  CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migrations applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
