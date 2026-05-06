CREATE TABLE IF NOT EXISTS raw_observations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  session_id TEXT,
  source_id TEXT,
  text TEXT,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_observations_scope_time ON raw_observations (guild_id, channel_id, user_id, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_raw_observations_kind_time ON raw_observations (kind, created_at_ms);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  session_id TEXT,
  summary TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_observation_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 1,
  starts_at_ms INTEGER,
  ends_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_scope_time ON episodes (guild_id, channel_id, session_id, created_at_ms);

CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  text TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 3,
  provenance_observation_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_memories_scope ON semantic_memories (guild_id, channel_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_semantic_memories_importance_time ON semantic_memories (importance, created_at_ms);

CREATE TABLE IF NOT EXISTS procedural_memories (
  id TEXT PRIMARY KEY NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  text TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 3,
  provenance_observation_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_procedural_memories_scope ON procedural_memories (guild_id, channel_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_procedural_memories_importance_time ON procedural_memories (importance, created_at_ms);

CREATE TABLE IF NOT EXISTS self_state (
  scope_key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  guild_id TEXT,
  user_id TEXT,
  value_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personality_settings (
  scope_key TEXT PRIMARY KEY NOT NULL,
  guild_id TEXT,
  user_id TEXT,
  profile_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
