import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rawObservations = sqliteTable(
  "raw_observations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    sessionId: text("session_id"),
    sourceId: text("source_id"),
    text: text("text"),
    payloadJson: text("payload_json").notNull(),
    confidence: real("confidence").notNull().default(1),
    importance: integer("importance").notNull().default(1),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [
    index("idx_raw_observations_scope_time").on(table.guildId, table.channelId, table.userId, table.createdAtMs),
    index("idx_raw_observations_kind_time").on(table.kind, table.createdAtMs),
  ],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    sessionId: text("session_id"),
    summary: text("summary").notNull(),
    participantsJson: text("participants_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceObservationIdsJson: text("source_observation_ids_json").notNull().default("[]"),
    confidence: real("confidence").notNull().default(1),
    importance: integer("importance").notNull().default(1),
    startsAtMs: integer("starts_at_ms"),
    endsAtMs: integer("ends_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [index("idx_episodes_scope_time").on(table.guildId, table.channelId, table.sessionId, table.createdAtMs)],
);

export const semanticMemories = sqliteTable(
  "semantic_memories",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    text: text("text").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    confidence: real("confidence").notNull().default(1),
    importance: integer("importance").notNull().default(3),
    provenanceObservationId: text("provenance_observation_id"),
    status: text("status").notNull().default("active"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_semantic_memories_scope").on(table.guildId, table.channelId, table.userId, table.status),
    index("idx_semantic_memories_importance_time").on(table.importance, table.createdAtMs),
  ],
);

export const proceduralMemories = sqliteTable(
  "procedural_memories",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id"),
    channelId: text("channel_id"),
    userId: text("user_id"),
    text: text("text").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    confidence: real("confidence").notNull().default(1),
    importance: integer("importance").notNull().default(3),
    provenanceObservationId: text("provenance_observation_id"),
    status: text("status").notNull().default("active"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    index("idx_procedural_memories_scope").on(table.guildId, table.channelId, table.userId, table.status),
    index("idx_procedural_memories_importance_time").on(table.importance, table.createdAtMs),
  ],
);

export const selfState = sqliteTable("self_state", {
  scopeKey: text("scope_key").primaryKey(),
  kind: text("kind").notNull(),
  guildId: text("guild_id"),
  userId: text("user_id"),
  valueJson: text("value_json").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const personalitySettings = sqliteTable("personality_settings", {
  scopeKey: text("scope_key").primaryKey(),
  guildId: text("guild_id"),
  userId: text("user_id"),
  profileId: text("profile_id").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export type RawObservationRow = typeof rawObservations.$inferSelect;
export type SemanticMemoryRow = typeof semanticMemories.$inferSelect;
export type ProceduralMemoryRow = typeof proceduralMemories.$inferSelect;
