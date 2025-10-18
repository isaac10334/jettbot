// db.ts
import { Database } from "bun:sqlite";

export const db = new Database("jettbot.sqlite", { create: true });
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
`);

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    guild_id TEXT,
    channel_id TEXT,
    user_id TEXT,
    state TEXT NOT NULL,                 -- JSON (agent state)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,                  -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,               -- JSON (text/audio refs)
    created_at INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,                  -- e.g., 'transcribe','summarize'
    payload TEXT NOT NULL,               -- JSON
    run_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed
    last_error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, run_at);

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                  -- 'discord.send','s3.upload', etc.
    payload TEXT NOT NULL,               -- JSON
    created_at INTEGER NOT NULL,
    delivered_at INTEGER                 -- null until processed
  );
  `);
}
