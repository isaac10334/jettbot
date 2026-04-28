import { describe, expect, test } from "bun:test";
import { parseEnv } from "../Env";

const required = {
  DISCORD_BOT_TOKEN: "discord-token",
  DISCORD_APPLICATION_ID: "app-id",
  ASSEMBLYAI_API_KEY: "assembly-key",
  ELEVENLABS_API_KEY: "eleven-key",
  ELEVENLABS_VOICE_ID: "voice-id",
  AI_GATEWAY_API_KEY: "gateway-key",
};

describe("Env", () => {
  test("applies defaults", () => {
    const result = parseEnv(required);
    expect(result.ok).toBe(true);
    expect(result.env?.ASSEMBLYAI_SPEECH_MODEL).toBe("u3-rt-pro");
    expect(result.env?.ASSEMBLYAI_SAMPLE_RATE).toBe(16000);
    expect(result.env?.AI_GATEWAY_MODEL).toBe("openai/gpt-5.4");
  });

  test("reports missing required vars", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("DISCORD_BOT_TOKEN is required");
  });
});

