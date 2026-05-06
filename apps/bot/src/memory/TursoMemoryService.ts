import { createClient, type Client } from "@libsql/client";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";
import type { Env } from "../Env";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";
import type { AddMemoryInput, MemoryItem, MemoryKind, MemoryMessage, MemorySearchOptions, MemoryService, RawObservation } from "./MemoryService";

const rowToMessage = (row: Record<string, unknown>): MemoryMessage => ({
  ...(typeof row.source_id === "string" ? { sourceId: row.source_id } : {}),
  ...(typeof row.guild_id === "string" ? { guildId: row.guild_id } : {}),
  ...(typeof row.channel_id === "string" ? { channelId: row.channel_id } : {}),
  ...(typeof row.user_id === "string" ? { userId: row.user_id } : {}),
  ...(typeof row.username === "string" ? { username: row.username } : {}),
  ...(typeof row.display_name === "string" ? { displayName: row.display_name } : {}),
  text: String(row.text ?? ""),
  createdAt: Number(row.created_at ?? row.created_at_ms ?? 0),
});

type MemoryTable = "messages" | "transcript_turns" | "tool_events";

const json = (value: unknown): string => JSON.stringify(value ?? {});

const parseTags = (value: string): readonly string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toMemoryItem = (kind: MemoryKind, row: schema.SemanticMemoryRow | schema.ProceduralMemoryRow): MemoryItem => ({
  id: row.id,
  kind,
  ...(row.guildId ? { guildId: row.guildId } : {}),
  ...(row.channelId ? { channelId: row.channelId } : {}),
  ...(row.userId ? { userId: row.userId } : {}),
  text: row.text,
  tags: parseTags(row.tagsJson),
  confidence: row.confidence,
  importance: row.importance,
  status: row.status,
  createdAtMs: row.createdAtMs,
  updatedAtMs: row.updatedAtMs,
});

const clampImportance = (value: number | undefined): number => {
  if (value == null || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
};

const scopeKey = (options?: { readonly guildId?: string; readonly userId?: string }): string => {
  if (options?.guildId && options.userId) return `guild:${options.guildId}:user:${options.userId}`;
  if (options?.guildId) return `guild:${options.guildId}`;
  if (options?.userId) return `user:${options.userId}`;
  return "global";
};

export const createTursoMemoryService = (env: Env): MemoryService => {
  const client: Client = createClient({
    url: env.TURSO_DATABASE_URL ?? "file:jettbot-memory.db",
    ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
  });
  const db = drizzle(client, { schema });

  const addColumnIfMissing = async (table: MemoryTable, column: string, definition: string) => {
    const result = await client.execute(`PRAGMA table_info(${table})`);
    const hasColumn = result.rows.some((row) => row.name === column);
    if (!hasColumn) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  const initialize = async () => {
    await client.batch(
      [
        "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, user_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS transcript_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, session_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, start_ms INTEGER, end_ms INTEGER, is_final INTEGER NOT NULL, received_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS embeddings (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER, model TEXT, vector BLOB)",
        "CREATE TABLE IF NOT EXISTS tool_events (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, session_id TEXT, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, created_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS raw_observations (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, guild_id TEXT, channel_id TEXT, user_id TEXT, session_id TEXT, source_id TEXT, text TEXT, payload_json TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, importance INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY NOT NULL, guild_id TEXT, channel_id TEXT, session_id TEXT, summary TEXT NOT NULL, participants_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', source_observation_ids_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1, importance INTEGER NOT NULL DEFAULT 1, starts_at_ms INTEGER, ends_at_ms INTEGER, created_at_ms INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS semantic_memories (id TEXT PRIMARY KEY NOT NULL, guild_id TEXT, channel_id TEXT, user_id TEXT, text TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1, importance INTEGER NOT NULL DEFAULT 3, provenance_observation_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS procedural_memories (id TEXT PRIMARY KEY NOT NULL, guild_id TEXT, channel_id TEXT, user_id TEXT, text TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1, importance INTEGER NOT NULL DEFAULT 3, provenance_observation_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS self_state (scope_key TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, guild_id TEXT, user_id TEXT, value_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS personality_settings (scope_key TEXT PRIMARY KEY NOT NULL, guild_id TEXT, user_id TEXT, profile_id TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)",
      ],
      "write",
    );

    await addColumnIfMissing("messages", "guild_id", "TEXT");
    await addColumnIfMissing("messages", "source_id", "TEXT");
    await addColumnIfMissing("messages", "username", "TEXT");
    await addColumnIfMissing("messages", "display_name", "TEXT");
    await addColumnIfMissing("transcript_turns", "guild_id", "TEXT");
    await addColumnIfMissing("transcript_turns", "channel_id", "TEXT");
    await addColumnIfMissing("transcript_turns", "session_id", "TEXT");
    await addColumnIfMissing("tool_events", "guild_id", "TEXT");
    await addColumnIfMissing("tool_events", "channel_id", "TEXT");
    await addColumnIfMissing("tool_events", "session_id", "TEXT");

    await client.batch(
      [
        "CREATE INDEX IF NOT EXISTS idx_messages_scope_time ON messages (guild_id, channel_id, user_id, created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_source_id ON messages (source_id)",
        "CREATE INDEX IF NOT EXISTS idx_transcript_turns_scope_time ON transcript_turns (guild_id, channel_id, session_id, user_id, received_at)",
        "CREATE INDEX IF NOT EXISTS idx_tool_events_scope_time ON tool_events (guild_id, channel_id, session_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_raw_observations_scope_time ON raw_observations (guild_id, channel_id, user_id, created_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_raw_observations_kind_time ON raw_observations (kind, created_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_episodes_scope_time ON episodes (guild_id, channel_id, session_id, created_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_semantic_memories_scope ON semantic_memories (guild_id, channel_id, user_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_semantic_memories_importance_time ON semantic_memories (importance, created_at_ms)",
        "CREATE INDEX IF NOT EXISTS idx_procedural_memories_scope ON procedural_memories (guild_id, channel_id, user_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_procedural_memories_importance_time ON procedural_memories (importance, created_at_ms)",
      ],
      "write",
    );
  };

  const observeRaw = async (observation: RawObservation): Promise<string> => {
    const id = observation.id ?? crypto.randomUUID();
    await db.insert(schema.rawObservations).values({
      id,
      kind: observation.kind,
      guildId: observation.guildId ?? null,
      channelId: observation.channelId ?? null,
      userId: observation.userId ?? null,
      sessionId: observation.sessionId ?? null,
      sourceId: observation.sourceId ?? null,
      text: observation.text ?? null,
      payloadJson: json(observation.payload ?? observation),
      confidence: observation.confidence ?? 1,
      importance: observation.importance ?? 1,
      createdAtMs: observation.createdAtMs ?? Date.now(),
    }).onConflictDoNothing();
    return id;
  };

  const addMemory = async (memory: AddMemoryInput): Promise<MemoryItem> => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const values = {
      id,
      guildId: memory.guildId ?? null,
      channelId: memory.channelId ?? null,
      userId: memory.userId ?? null,
      text: memory.text,
      tagsJson: json(memory.tags ?? []),
      confidence: memory.confidence ?? 1,
      importance: clampImportance(memory.importance),
      provenanceObservationId: memory.provenanceObservationId ?? null,
      status: "active",
      createdAtMs: now,
      updatedAtMs: now,
    };
    if (memory.kind === "semantic") {
      await db.insert(schema.semanticMemories).values(values);
      return toMemoryItem("semantic", values);
    }
    await db.insert(schema.proceduralMemories).values(values);
    return toMemoryItem("procedural", values);
  };

  const scopeFilter = (table: typeof schema.semanticMemories | typeof schema.proceduralMemories, options?: MemorySearchOptions) =>
    and(
      eq(table.status, "active"),
      options?.guildId ? or(eq(table.guildId, options.guildId), isNull(table.guildId)) : undefined,
      options?.channelId ? or(eq(table.channelId, options.channelId), isNull(table.channelId)) : undefined,
      options?.userId ? or(eq(table.userId, options.userId), isNull(table.userId)) : undefined,
    );

  const searchOneKind = async (kind: MemoryKind, query: string, options?: MemorySearchOptions): Promise<readonly MemoryItem[]> => {
    const table = kind === "semantic" ? schema.semanticMemories : schema.proceduralMemories;
    const rows = await db
      .select()
      .from(table)
      .where(and(scopeFilter(table, options), like(table.text, `%${query}%`)))
      .orderBy(desc(table.importance), desc(table.createdAtMs))
      .limit(options?.limit ?? 10);
    return rows.map((row) => toMemoryItem(kind, row));
  };

  const recentOneKind = async (kind: MemoryKind, options?: MemorySearchOptions): Promise<readonly MemoryItem[]> => {
    const table = kind === "semantic" ? schema.semanticMemories : schema.proceduralMemories;
    const rows = await db
      .select()
      .from(table)
      .where(scopeFilter(table, options))
      .orderBy(desc(table.importance), desc(table.createdAtMs))
      .limit(options?.limit ?? 10);
    return rows.map((row) => toMemoryItem(kind, row));
  };

  return {
    initialize,
    saveMessage: async (memory) => {
      await client.execute({
        sql: "INSERT OR IGNORE INTO messages (source_id, guild_id, channel_id, user_id, username, display_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          memory.sourceId ?? null,
          memory.guildId ?? null,
          memory.channelId ?? null,
          memory.userId ?? null,
          memory.username ?? null,
          memory.displayName ?? null,
          memory.text,
          memory.createdAt,
        ],
      });
      await observeRaw({
        ...(memory.sourceId ? { id: `discord-message:${memory.sourceId}`, sourceId: memory.sourceId } : {}),
        kind: "discord.message",
        ...(memory.guildId ? { guildId: memory.guildId } : {}),
        ...(memory.channelId ? { channelId: memory.channelId } : {}),
        ...(memory.userId ? { userId: memory.userId } : {}),
        text: memory.text,
        payload: memory,
        createdAtMs: memory.createdAt,
      });
    },
    saveTranscriptTurn: async (turn: TranscriptTurn) => {
      await client.execute({
        sql: "INSERT INTO transcript_turns (guild_id, channel_id, session_id, user_id, text, start_ms, end_ms, is_final, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [turn.guildId, turn.channelId, turn.sessionId, turn.userId, turn.text, turn.startMs ?? null, turn.endMs ?? null, turn.isFinal ? 1 : 0, turn.receivedAt],
      });
      if (turn.isFinal && !turn.userId.startsWith("unknown_ssrc:")) {
        await observeRaw({
          kind: "voice.transcript.final",
          guildId: turn.guildId,
          channelId: turn.channelId,
          sessionId: turn.sessionId,
          userId: turn.userId,
          text: turn.text,
          payload: turn,
          createdAtMs: turn.receivedAt,
        });
      }
    },
    observeRaw,
    addMemory,
    searchMemoryItems: async (query, options) => {
      const kinds: readonly MemoryKind[] = options?.kind ? [options.kind] : ["semantic", "procedural"];
      const rows = (await Promise.all(kinds.map((kind) => searchOneKind(kind, query, options)))).flat();
      return rows.sort((a, b) => b.importance - a.importance || b.createdAtMs - a.createdAtMs).slice(0, options?.limit ?? 10);
    },
    recentMemoryItems: async (options) => {
      const kinds: readonly MemoryKind[] = options?.kind ? [options.kind] : ["semantic", "procedural"];
      const rows = (await Promise.all(kinds.map((kind) => recentOneKind(kind, options)))).flat();
      return rows.sort((a, b) => b.importance - a.importance || b.createdAtMs - a.createdAtMs).slice(0, options?.limit ?? 10);
    },
    search: async (query, options) => {
      const result = await client.execute({
        sql: "SELECT source_id, guild_id, channel_id, user_id, username, display_name, text, created_at FROM messages WHERE text LIKE ? ORDER BY CASE WHEN ? IS NOT NULL AND guild_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?",
        args: [`%${query}%`, options?.guildId ?? null, options?.guildId ?? null, options?.limit ?? 10],
      });
      return result.rows.map((row) => rowToMessage(row));
    },
    semanticSearch: async (query, options) => {
      const result = await client.execute({
        sql: "SELECT source_id, guild_id, channel_id, user_id, username, display_name, text, created_at FROM messages WHERE text LIKE ? ORDER BY CASE WHEN ? IS NOT NULL AND guild_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?",
        args: [`%${query}%`, options?.guildId ?? null, options?.guildId ?? null, options?.limit ?? 10],
      });
      return result.rows.map((row) => rowToMessage(row));
    },
    getRecentConversation: async (guildId, channelId, userId) => {
      const result = await client.execute({
        sql: "SELECT source_id, guild_id, channel_id, user_id, username, display_name, text, created_at FROM messages WHERE (? IS NULL OR guild_id = ?) AND (? IS NULL OR channel_id = ?) AND (? IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT 24",
        args: [guildId ?? null, guildId ?? null, channelId ?? null, channelId ?? null, userId ?? null, userId ?? null],
      });
      return result.rows.map((row) => rowToMessage(row)).reverse();
    },
    setSelfState: async (key, kind, value, options) => {
      await db
        .insert(schema.selfState)
        .values({
          scopeKey: key,
          kind,
          guildId: options?.guildId ?? null,
          userId: options?.userId ?? null,
          valueJson: json(value),
          updatedAtMs: Date.now(),
        })
        .onConflictDoUpdate({
          target: schema.selfState.scopeKey,
          set: {
            kind,
            guildId: options?.guildId ?? null,
            userId: options?.userId ?? null,
            valueJson: json(value),
            updatedAtMs: Date.now(),
          },
        });
    },
    getSelfState: async (key) => {
      const rows = await db.select().from(schema.selfState).where(eq(schema.selfState.scopeKey, key)).limit(1);
      const raw = rows[0]?.valueJson;
      if (!raw) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    setPersonalityProfile: async (profileId, options) => {
      const key = scopeKey(options);
      await db
        .insert(schema.personalitySettings)
        .values({
          scopeKey: key,
          guildId: options?.guildId ?? null,
          userId: options?.userId ?? null,
          profileId,
          updatedAtMs: Date.now(),
        })
        .onConflictDoUpdate({
          target: schema.personalitySettings.scopeKey,
          set: {
            guildId: options?.guildId ?? null,
            userId: options?.userId ?? null,
            profileId,
            updatedAtMs: Date.now(),
          },
        });
    },
    getPersonalityProfile: async (options) => {
      const keys = [scopeKey(options), options?.guildId ? scopeKey({ guildId: options.guildId }) : undefined, "global"].filter(
        (item): item is string => typeof item === "string",
      );
      for (const key of keys) {
        const rows = await db.select().from(schema.personalitySettings).where(eq(schema.personalitySettings.scopeKey, key)).limit(1);
        const profileId = rows[0]?.profileId;
        if (profileId) return profileId;
      }
      return undefined;
    },
    summarizeSession: async () => "Session summarization is not implemented yet.",
    close: () => client.close(),
  };
};
