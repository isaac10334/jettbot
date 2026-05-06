import { createClient, type Client } from "@libsql/client";
import type { Env } from "../Env";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";
import type { MemoryMessage, MemoryService } from "./MemoryService";

const rowToMessage = (row: Record<string, unknown>): MemoryMessage => ({
  ...(typeof row.guild_id === "string" ? { guildId: row.guild_id } : {}),
  ...(typeof row.channel_id === "string" ? { channelId: row.channel_id } : {}),
  ...(typeof row.user_id === "string" ? { userId: row.user_id } : {}),
  text: String(row.text ?? ""),
  createdAt: Number(row.created_at ?? 0),
});

type MemoryTable = "messages" | "transcript_turns" | "tool_events";

export const createTursoMemoryService = (env: Env): MemoryService => {
  const client: Client = createClient({
    url: env.TURSO_DATABASE_URL ?? "file:jettbot-memory.db",
    ...(env.TURSO_AUTH_TOKEN ? { authToken: env.TURSO_AUTH_TOKEN } : {}),
  });

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
      ],
      "write",
    );

    await addColumnIfMissing("messages", "guild_id", "TEXT");
    await addColumnIfMissing("transcript_turns", "guild_id", "TEXT");
    await addColumnIfMissing("transcript_turns", "channel_id", "TEXT");
    await addColumnIfMissing("transcript_turns", "session_id", "TEXT");
    await addColumnIfMissing("tool_events", "guild_id", "TEXT");
    await addColumnIfMissing("tool_events", "channel_id", "TEXT");
    await addColumnIfMissing("tool_events", "session_id", "TEXT");

    await client.batch(
      [
        "CREATE INDEX IF NOT EXISTS idx_messages_scope_time ON messages (guild_id, channel_id, user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_transcript_turns_scope_time ON transcript_turns (guild_id, channel_id, session_id, user_id, received_at)",
        "CREATE INDEX IF NOT EXISTS idx_tool_events_scope_time ON tool_events (guild_id, channel_id, session_id, created_at)",
      ],
      "write",
    );
  };

  return {
    initialize,
    saveMessage: async (memory) => {
      await client.execute({
        sql: "INSERT INTO messages (guild_id, channel_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [memory.guildId ?? null, memory.channelId ?? null, memory.userId ?? null, memory.text, memory.createdAt],
      });
    },
    saveTranscriptTurn: async (turn: TranscriptTurn) => {
      await client.execute({
        sql: "INSERT INTO transcript_turns (guild_id, channel_id, session_id, user_id, text, start_ms, end_ms, is_final, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [turn.guildId, turn.channelId, turn.sessionId, turn.userId, turn.text, turn.startMs ?? null, turn.endMs ?? null, turn.isFinal ? 1 : 0, turn.receivedAt],
      });
    },
    search: async (query, options) => {
      const result = await client.execute({
        sql: "SELECT guild_id, channel_id, user_id, text, created_at FROM messages WHERE text LIKE ? ORDER BY CASE WHEN ? IS NOT NULL AND guild_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?",
        args: [`%${query}%`, options?.guildId ?? null, options?.guildId ?? null, options?.limit ?? 10],
      });
      return result.rows.map((row) => rowToMessage(row));
    },
    semanticSearch: async (query, options) => {
      const result = await client.execute({
        sql: "SELECT guild_id, channel_id, user_id, text, created_at FROM messages WHERE text LIKE ? ORDER BY CASE WHEN ? IS NOT NULL AND guild_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?",
        args: [`%${query}%`, options?.guildId ?? null, options?.guildId ?? null, options?.limit ?? 10],
      });
      return result.rows.map((row) => rowToMessage(row));
    },
    getRecentConversation: async (guildId, channelId, userId) => {
      const result = await client.execute({
        sql: "SELECT guild_id, channel_id, user_id, text, created_at FROM messages WHERE (? IS NULL OR guild_id = ?) AND (? IS NULL OR channel_id = ?) AND (? IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT 12",
        args: [guildId ?? null, guildId ?? null, channelId ?? null, channelId ?? null, userId ?? null, userId ?? null],
      });
      return result.rows.map((row) => rowToMessage(row)).reverse();
    },
    summarizeSession: async () => "Session summarization is not implemented yet.",
    close: () => client.close(),
  };
};
