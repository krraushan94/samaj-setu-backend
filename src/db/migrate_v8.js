require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/db');

// Migration v8 — per-department task tracker and group chat. Only team
// leaders/members (own department) and admin (every department) ever touch
// these; citizens have no access at all. created_by/sender_id are plain
// strings rather than a hard FK — the creator/sender can be either a
// team_members row or the admin's fixed 'admin' id, which don't share an
// FK-able id space (same pattern already used for ticket_history.changed_by
// and notifications.recipient_role).
const migration = `
  CREATE TABLE IF NOT EXISTS team_tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id    UUID REFERENCES departments(id) ON DELETE CASCADE,
    title            VARCHAR(200) NOT NULL,
    description      TEXT,
    assigned_to      UUID REFERENCES team_members(id) ON DELETE SET NULL,
    assigned_to_name VARCHAR(100),
    created_by       VARCHAR(100) NOT NULL,
    created_by_role  VARCHAR(20) NOT NULL,
    created_by_name  VARCHAR(100),
    status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
    priority         VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    due_date         DATE,
    progress_note    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS team_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id  UUID REFERENCES departments(id) ON DELETE CASCADE,
    sender_id      VARCHAR(100) NOT NULL,
    sender_role    VARCHAR(20) NOT NULL,
    sender_name    VARCHAR(100) NOT NULL,
    message        TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_team_tasks_dept      ON team_tasks(department_id);
  CREATE INDEX IF NOT EXISTS idx_team_tasks_status    ON team_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_team_tasks_assignee  ON team_tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_team_messages_dept   ON team_messages(department_id, created_at);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('✅ Migration v8 applied successfully');
  } catch (err) {
    console.error('❌ Migration v8 failed:', err.message);
    if (require.main === module) process.exit(1);
    throw err;
  } finally {
    if (require.main === module) await pool.end();
  }
}

if (require.main === module) migrate();
module.exports = migrate;
