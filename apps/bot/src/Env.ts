export interface Env {
  readonly DISCORD_BOT_TOKEN: string;
  readonly DISCORD_APPLICATION_ID: string;
  readonly DISCORD_GUILD_ID?: string;
  readonly JETTBOT_RUST_SIDECAR_PATH: string;
  readonly JETTBOT_IPC_MODE: "stdio";
  readonly JETTBOT_LOG_LEVEL: "debug" | "info" | "warn" | "error";
  readonly JETTBOT_LOG_FILE_PATH: string;
  readonly JETTBOT_LOG_MAX_ENTRIES: number;
  readonly JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS: number;
  readonly JETTBOT_METRICS_FILE_PATH: string;
  readonly ASSEMBLYAI_API_KEY: string;
  readonly ASSEMBLYAI_SPEECH_MODEL: string;
  readonly ASSEMBLYAI_SAMPLE_RATE: number;
  readonly ASSEMBLYAI_TRANSCRIPTION_PROMPT: string;
  readonly ELEVENLABS_API_KEY: string;
  readonly ELEVENLABS_VOICE_ID: string;
  readonly ELEVENLABS_MODEL_ID: string;
  readonly ELEVENLABS_OUTPUT_FORMAT: string;
  readonly AI_GATEWAY_API_KEY: string;
  readonly AI_GATEWAY_MODEL: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  readonly YOUTUBE_COOKIES_PATH?: string;
  readonly YTDLP_PATH: string;
  readonly FFMPEG_PATH: string;
}

export interface EnvParseResult {
  readonly ok: boolean;
  readonly env?: Env;
  readonly errors?: readonly string[];
}

type EnvSource = Record<string, string | undefined>;

const required = (source: EnvSource, key: string): string | undefined => {
  const value = source[key];
  return value == null || value.trim() === "" ? undefined : value;
};

const optional = (source: EnvSource, key: string): string | undefined => {
  const value = source[key];
  return value == null || value.trim() === "" ? undefined : value;
};

const parseLogLevel = (value: string): Env["JETTBOT_LOG_LEVEL"] | undefined => {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  return undefined;
};

const parsePositiveInteger = (source: EnvSource, key: string, fallback: number, errors: string[]): number => {
  const text = optional(source, key);
  if (text == null) return fallback;
  const value = Number.parseInt(text, 10);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${key} must be a positive integer`);
    return fallback;
  }
  return value;
};

export const parseEnv = (source: EnvSource = Bun.env): EnvParseResult => {
  const errors: string[] = [];
  const need = (key: string): string => {
    const value = required(source, key);
    if (value == null) errors.push(`${key} is required`);
    return value ?? "";
  };

  const sampleRateText = optional(source, "ASSEMBLYAI_SAMPLE_RATE") ?? "16000";
  const sampleRate = Number.parseInt(sampleRateText, 10);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    errors.push("ASSEMBLYAI_SAMPLE_RATE must be a positive integer");
  }

  const logLevelText = optional(source, "JETTBOT_LOG_LEVEL") ?? "info";
  const logLevel = parseLogLevel(logLevelText);
  if (logLevel == null) errors.push("JETTBOT_LOG_LEVEL must be debug, info, warn, or error");
  const logMaxEntries = parsePositiveInteger(source, "JETTBOT_LOG_MAX_ENTRIES", 2_000, errors);
  const observabilityFlushIntervalMs = parsePositiveInteger(source, "JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS", 1_000, errors);

  const ipcMode = optional(source, "JETTBOT_IPC_MODE") ?? "stdio";
  if (ipcMode !== "stdio") errors.push("JETTBOT_IPC_MODE must be stdio");

  const discordGuildId = optional(source, "DISCORD_GUILD_ID");
  const tursoDatabaseUrl = optional(source, "TURSO_DATABASE_URL");
  const tursoAuthToken = optional(source, "TURSO_AUTH_TOKEN");
  const youtubeCookiesPath = optional(source, "YOUTUBE_COOKIES_PATH");

  const env: Env = {
    DISCORD_BOT_TOKEN: need("DISCORD_BOT_TOKEN"),
    DISCORD_APPLICATION_ID: need("DISCORD_APPLICATION_ID"),
    ...(discordGuildId ? { DISCORD_GUILD_ID: discordGuildId } : {}),
    JETTBOT_RUST_SIDECAR_PATH: optional(source, "JETTBOT_RUST_SIDECAR_PATH") ?? "./target/release/jettbot-voice-sidecar",
    JETTBOT_IPC_MODE: "stdio",
    JETTBOT_LOG_LEVEL: logLevel ?? "info",
    JETTBOT_LOG_FILE_PATH: optional(source, "JETTBOT_LOG_FILE_PATH") ?? "./logs/jettbot.log.jsonl",
    JETTBOT_LOG_MAX_ENTRIES: logMaxEntries,
    JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS: observabilityFlushIntervalMs,
    JETTBOT_METRICS_FILE_PATH: optional(source, "JETTBOT_METRICS_FILE_PATH") ?? "./logs/metrics.json",
    ASSEMBLYAI_API_KEY: need("ASSEMBLYAI_API_KEY"),
    ASSEMBLYAI_SPEECH_MODEL: optional(source, "ASSEMBLYAI_SPEECH_MODEL") ?? "u3-rt-pro",
    ASSEMBLYAI_SAMPLE_RATE: Number.isInteger(sampleRate) ? sampleRate : 16000,
    ASSEMBLYAI_TRANSCRIPTION_PROMPT: optional(source, "ASSEMBLYAI_TRANSCRIPTION_PROMPT") ?? "",
    ELEVENLABS_API_KEY: need("ELEVENLABS_API_KEY"),
    ELEVENLABS_VOICE_ID: need("ELEVENLABS_VOICE_ID"),
    ELEVENLABS_MODEL_ID: optional(source, "ELEVENLABS_MODEL_ID") ?? "eleven_multilingual_v2",
    ELEVENLABS_OUTPUT_FORMAT: optional(source, "ELEVENLABS_OUTPUT_FORMAT") ?? "opus_48000_128",
    AI_GATEWAY_API_KEY: need("AI_GATEWAY_API_KEY"),
    AI_GATEWAY_MODEL: optional(source, "AI_GATEWAY_MODEL") ?? "openai/gpt-5.4",
    ...(tursoDatabaseUrl ? { TURSO_DATABASE_URL: tursoDatabaseUrl } : {}),
    ...(tursoAuthToken ? { TURSO_AUTH_TOKEN: tursoAuthToken } : {}),
    ...(youtubeCookiesPath ? { YOUTUBE_COOKIES_PATH: youtubeCookiesPath } : {}),
    YTDLP_PATH: optional(source, "YTDLP_PATH") ?? "yt-dlp",
    FFMPEG_PATH: optional(source, "FFMPEG_PATH") ?? "ffmpeg",
  };

  return errors.length === 0 ? { ok: true, env } : { ok: false, errors };
};

export const loadEnv = (): Env => {
  const result = parseEnv(Bun.env);
  if (!result.ok) throw new Error(`Invalid environment:\n${(result.errors ?? []).join("\n")}`);
  if (!result.env) throw new Error("Invalid environment");
  return result.env;
};
