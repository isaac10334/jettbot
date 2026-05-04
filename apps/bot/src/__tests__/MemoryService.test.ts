import { describe, expect, test } from "bun:test";
import { createTursoMemoryService } from "../memory/TursoMemoryService";

describe("TursoMemoryService", () => {
  test("stores and searches messages", async () => {
    const memory = createTursoMemoryService({
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
      TURSO_DATABASE_URL: ":memory:",
      YTDLP_PATH: "yt-dlp",
      FFMPEG_PATH: "ffmpeg",
    });
    await memory.initialize();
    await memory.saveMessage({ text: "hello memory", userId: "u1", createdAt: 1 });
    const result = await memory.search("memory");
    expect(result[0]?.text).toBe("hello memory");
    memory.close();
  });
});
