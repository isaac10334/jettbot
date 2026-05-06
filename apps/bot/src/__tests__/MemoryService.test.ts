import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../Env";
import { createTursoMemoryService } from "../memory/TursoMemoryService";

const createTestEnv = (tursoDatabaseUrl: string): Env => ({
  DISCORD_BOT_TOKEN: "x",
  DISCORD_APPLICATION_ID: "x",
  JETTBOT_RUST_SIDECAR_PATH: "x",
  JETTBOT_IPC_MODE: "stdio",
  JETTBOT_LOG_LEVEL: "info",
  JETTBOT_LOG_FILE_PATH: "./logs/test.log.jsonl",
  JETTBOT_LOG_MAX_ENTRIES: 10,
  JETTBOT_SIDECAR_LOG_FILE_PATH: "./logs/test.sidecar.log",
  JETTBOT_SIDECAR_CONSOLE_LEVEL: "warn",
  JETTBOT_SIDECAR_RUST_LOG: "warn,jettbot_voice_sidecar=info",
  JETTBOT_REALTIME_DEBUG_ENABLED: true,
  JETTBOT_REALTIME_DEBUG_DIR: "./logs/test-realtime",
  JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS: 1_000,
  JETTBOT_METRICS_FILE_PATH: "./logs/test.metrics.json",
  ASSEMBLYAI_API_KEY: "x",
  ASSEMBLYAI_SPEECH_MODEL: "u3-rt-pro",
  ASSEMBLYAI_SAMPLE_RATE: 16000,
  ASSEMBLYAI_TRANSCRIPTION_PROMPT: "",
  ELEVENLABS_API_KEY: "x",
  ELEVENLABS_VOICE_ID: "x",
  ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
  ELEVENLABS_OUTPUT_FORMAT: "opus_48000_128",
  AI_GATEWAY_API_KEY: "x",
  AI_GATEWAY_MODEL: "openai/gpt-5.4",
  BRAVE_SEARCH_API_KEY: "x",
  JETTBOT_IMAGE_SEARCH_COUNT: 20,
  JETTBOT_IMAGE_SEARCH_RATE_LIMIT_COUNT: 5,
  JETTBOT_IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS: 60_000,
  JETTBOT_IMAGE_SEARCH_SESSION_TTL_MS: 600_000,
  TURSO_DATABASE_URL: tursoDatabaseUrl,
  YTDLP_PATH: "yt-dlp",
  FFMPEG_PATH: "ffmpeg",
});

describe("TursoMemoryService", () => {
  test("stores and searches messages", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    await memory.saveMessage({ guildId: "guild-a", channelId: "channel-a", text: "shared memory from a", userId: "u1", createdAt: 1 });
    await memory.saveMessage({ guildId: "guild-b", channelId: "channel-b", text: "shared memory from b", userId: "u1", createdAt: 2 });
    await memory.saveTranscriptTurn({
      guildId: "guild-a",
      channelId: "voice-a",
      sessionId: "session-a",
      userId: "u1",
      text: "voice provenance",
      isFinal: true,
      receivedAt: 3,
    });
    const result = await memory.search("memory", { guildId: "guild-b" });
    expect(result.map((row) => row.text)).toEqual(["shared memory from b", "shared memory from a"]);
    memory.close();
  });

  test("stores layered memory items and persisted personality settings", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    await memory.addMemory({ kind: "semantic", guildId: "guild-a", text: "Isaac likes unhinged dry jokes.", importance: 5 });
    await memory.addMemory({ kind: "procedural", guildId: "guild-a", text: "When Isaac asks for commands, give the copy-paste block first.", importance: 4 });
    await memory.setSelfState("runtime", "runtime", { voice: "connected" }, { guildId: "guild-a" });
    await memory.setPersonalityProfile("dry_menace", { guildId: "guild-a" });

    const rows = await memory.searchMemoryItems("Isaac", { guildId: "guild-a", limit: 5 });

    expect(rows.map((row) => row.kind)).toEqual(["semantic", "procedural"]);
    expect(await memory.getSelfState("runtime")).toEqual({ voice: "connected" });
    expect(await memory.getPersonalityProfile({ guildId: "guild-a" })).toBe("dry_menace");
    memory.close();
  });

  test("migrates pre-multi-guild tables before creating scoped indexes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jettbot-memory-test-"));
    const databaseUrl = `file:${join(directory, "memory.db").replaceAll("\\", "/")}`;
    const setup = createClient({ url: databaseUrl });
    await setup.batch(
      [
        "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT, user_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE TABLE transcript_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, start_ms INTEGER, end_ms INTEGER, is_final INTEGER NOT NULL, received_at INTEGER NOT NULL)",
        "CREATE TABLE tool_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, created_at INTEGER NOT NULL)",
        "INSERT INTO messages (channel_id, user_id, text, created_at) VALUES ('legacy-channel', 'u1', 'legacy memory', 1)",
      ],
      "write",
    );
    setup.close();

    const memory = createTursoMemoryService(createTestEnv(databaseUrl));
    try {
      await memory.initialize();
      await memory.saveMessage({ guildId: "guild-a", channelId: "channel-a", text: "guild memory", userId: "u2", createdAt: 2 });
      await memory.saveTranscriptTurn({
        guildId: "guild-a",
        channelId: "voice-a",
        sessionId: "session-a",
        userId: "u1",
        text: "voice memory",
        isFinal: true,
        receivedAt: 3,
      });
      const result = await memory.search("memory", { guildId: "guild-a" });
      expect(result.map((row) => row.text)).toEqual(["guild memory", "legacy memory"]);
    } finally {
      memory.close();
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
