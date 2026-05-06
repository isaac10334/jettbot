import { describe, expect, test } from "bun:test";
import { parseEnv } from "../Env";

const required = {
  DISCORD_BOT_TOKEN: "discord-token",
  DISCORD_APPLICATION_ID: "app-id",
  ASSEMBLYAI_API_KEY: "assembly-key",
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  AI_GATEWAY_API_KEY: "gateway-key",
  BRAVE_SEARCH_API_KEY: "brave-key",
};

describe("Env", () => {
  test("applies defaults", () => {
    const result = parseEnv(required);
    expect(result.ok).toBe(true);
    expect(result.env?.ASSEMBLYAI_SPEECH_MODEL).toBe("u3-rt-pro");
    expect(result.env?.ASSEMBLYAI_SAMPLE_RATE).toBe(16000);
    expect(result.env?.ELEVENLABS_OUTPUT_FORMAT).toBe("pcm_24000");
    expect(result.env?.AI_GATEWAY_MODEL).toBe("openai/gpt-5.4");
    expect(result.env?.JETTBOT_IMAGE_SEARCH_COUNT).toBe(20);
    expect(result.env?.JETTBOT_SIDECAR_LOG_FILE_PATH).toBe("./logs/sidecar.log");
    expect(result.env?.JETTBOT_SIDECAR_CONSOLE_LEVEL).toBe("warn");
    expect(result.env?.JETTBOT_SIDECAR_RUST_LOG).toBe("warn,jettbot_voice_sidecar=info");
    expect(result.env?.JETTBOT_REALTIME_DEBUG_ENABLED).toBe(true);
    expect(result.env?.JETTBOT_REALTIME_DEBUG_DIR).toBe("./logs/realtime");
    expect(result.env?.ADMIN_USER_ID).toBeUndefined();
  });

  test("parses optional admin user id", () => {
    const result = parseEnv({ ...required, ADMIN_USER_ID: "377268939035639810" });
    expect(result.ok).toBe(true);
    expect(result.env?.ADMIN_USER_ID).toBe("377268939035639810");
  });

  test("reports missing required vars", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("DISCORD_BOT_TOKEN is required");
  });

  test("reports invalid sidecar console level", () => {
    const result = parseEnv({ ...required, JETTBOT_SIDECAR_CONSOLE_LEVEL: "verbose" });
    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("JETTBOT_SIDECAR_CONSOLE_LEVEL must be off, debug, info, warn, or error");
  });

  test("reports invalid realtime debug enabled flag", () => {
    const result = parseEnv({ ...required, JETTBOT_REALTIME_DEBUG_ENABLED: "sometimes" });
    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("JETTBOT_REALTIME_DEBUG_ENABLED must be true or false");
  });

  test("requires the supported AssemblyAI sample rate", () => {
    const result = parseEnv({ ...required, ASSEMBLYAI_SAMPLE_RATE: "48000" });
    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("ASSEMBLYAI_SAMPLE_RATE must be 16000");
  });
});
