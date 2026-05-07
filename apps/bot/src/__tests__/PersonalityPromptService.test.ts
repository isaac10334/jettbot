import { describe, expect, test } from "bun:test";
import type { Env } from "../Env";
import { createConversationService } from "../ai/ConversationService";
import { isAdminUser } from "../discord/installDiscordVoiceCommandPolicy";
import { createTursoMemoryService } from "../memory/TursoMemoryService";
import { createPersonalityService } from "../personality/PersonalityService";
import { createTranscriptStitcherService } from "../transcription/TranscriptStitcherService";

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
  ELEVENLABS_OUTPUT_FORMAT: "pcm_24000",
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

describe("personality and prompt assembly", () => {
  test("defaults to the configured profile and persists selected profile", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    const personality = createPersonalityService(memory);

    expect((await personality.getActiveProfile({ guildId: "guild" })).id).toBe(personality.defaultProfileId);
    await personality.setActiveProfile("chaotic_character", { guildId: "guild" });
    expect((await personality.getActiveProfile({ guildId: "guild" })).id).toBe("chaotic_character");

    memory.close();
  });

  test("persists durable character state and includes it in shared prompts", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    const personality = createPersonalityService(memory);
    await personality.setCharacterState(
      {
        mood: "quietly furious about being called J-Pod",
        disposition: "cordial, but keeping receipts",
        grudges: ["Nathan called him J-Pod twice"],
      },
      { guildId: "guild" },
    );
    const conversation = createConversationService({ transcripts: createTranscriptStitcherService(), memory, personality });

    const messages = await conversation.buildTextMessages({
      guildId: "guild",
      channelId: "channel",
      userId: "user",
      text: "hey",
    });
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain("Durable character continuity from the database");
    expect(text).toContain("quietly furious about being called J-Pod");
    expect(text).toContain("Nathan called him J-Pod twice");
    memory.close();
  });

  test("assembles active personality and scoped memory into voice prompts", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    await memory.addMemory({ kind: "semantic", guildId: "guild", userId: "user", text: "Isaac wants Jettbot to be funnier.", importance: 5 });
    const personality = createPersonalityService(memory);
    const transcripts = createTranscriptStitcherService();
    transcripts.acceptTurn({
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      userId: "user",
      displayName: "Isaac",
      text: "J-Pod, are you here?",
      isFinal: true,
      receivedAt: 1,
    });
    const conversation = createConversationService({ transcripts, memory, personality });

    const messages = await conversation.buildMessages({
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      userId: "user",
      displayName: "Isaac",
      text: "J-Pod, are you here?",
      isFinal: true,
      receivedAt: 1,
    });
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain("Jettbot");
    expect(text).toContain("Isaac wants Jettbot to be funnier.");
    expect(text).toContain("J-Pod, are you here?");
    memory.close();
  });

  test("assembles cached channel messages into text mention prompts", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    await memory.saveMessage({
      sourceId: "m1",
      guildId: "guild",
      channelId: "channel",
      userId: "user-a",
      username: "nathan",
      displayName: "Nathan",
      text: "The bass part is too quiet.",
      createdAt: 1,
    });
    await memory.saveMessage({
      sourceId: "m2",
      guildId: "guild",
      channelId: "channel",
      userId: "user-b",
      username: "isaac",
      displayName: "Isaac",
      text: "Jettbot, what did Nathan just say?",
      createdAt: 2,
    });
    const personality = createPersonalityService(memory);
    const conversation = createConversationService({ transcripts: createTranscriptStitcherService(), memory, personality });

    const messages = await conversation.buildTextMessages({
      guildId: "guild",
      channelId: "channel",
      userId: "user-b",
      text: "what did Nathan just say?",
    });
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain("Recent channel messages from the local database");
    expect(text).toContain("Nathan (user-a): The bass part is too quiet.");
    expect(text).toContain("Isaac (user-b): Jettbot, what did Nathan just say?");
    memory.close();
  });

  test("dedupes Discord messages by source id", async () => {
    const memory = createTursoMemoryService(createTestEnv(":memory:"));
    await memory.initialize();
    await memory.saveMessage({ sourceId: "same", guildId: "guild", channelId: "channel", userId: "user", text: "first", createdAt: 1 });
    await memory.saveMessage({ sourceId: "same", guildId: "guild", channelId: "channel", userId: "user", text: "second", createdAt: 2 });

    const rows = await memory.getRecentConversation("guild", "channel");

    expect(rows.map((row) => row.text)).toEqual(["first"]);
    memory.close();
  });

  test("admin check denies unset and mismatched users", () => {
    expect(isAdminUser(undefined, "user")).toBe(false);
    expect(isAdminUser("admin", "user")).toBe(false);
    expect(isAdminUser("admin", "admin")).toBe(true);
  });
});
