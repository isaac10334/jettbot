import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRealtimeDebugCaptureService } from "../observability/RealtimeDebugCaptureService";

const tempDirs: string[] = [];

const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("RealtimeDebugCaptureService", () => {
  test("writes text logs and wav audio under a voice session folder", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "jettbot-realtime-debug-"));
    tempDirs.push(baseDir);
    const capture = createRealtimeDebugCaptureService({ enabled: true, baseDir });

    capture.startVoiceSession({
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      startedAt: new Date(2026, 4, 2, 11, 2),
    });
    capture.writeJsonLine("text/transcripts.jsonl", { userId: "user", text: "hello" });
    capture.writeAudioChunk("user:user:discord-input", {
      kind: "pcm_s16le",
      relativePath: "audio/users/user/discord-input.wav",
      bytes: new Uint8Array([0, 0, 1, 0]),
      sampleRate: 16000,
      channels: 1,
    });
    await capture.endVoiceSession();

    await waitFor(async () => (await readdir(baseDir)).length > 0);
    await waitFor(async () => (await readdir(baseDir)).length > 0);
    await waitFor(async () => (await readdir(baseDir)).length > 0);
    const [sessionFolder] = await readdir(baseDir);
    expect(sessionFolder).toContain("5-2-26_11-02-AM");

    const sessionPath = join(baseDir, sessionFolder ?? "");
    const transcript = await readFile(join(sessionPath, "text", "transcripts.jsonl"), "utf8");
    expect(transcript).toContain("hello");

    const wav = await readFile(join(sessionPath, "audio", "users", "user", "discord-input.wav"));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(40)).toBe(4);
  });

  test("keeps wav headers readable before the session is closed", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "jettbot-realtime-debug-"));
    tempDirs.push(baseDir);
    const capture = createRealtimeDebugCaptureService({ enabled: true, baseDir });

    capture.startVoiceSession({
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      startedAt: new Date(2026, 4, 2, 11, 2),
    });
    capture.writeAudioChunk("user:user:discord-input", {
      kind: "pcm_s16le",
      relativePath: "audio/users/user/discord-input.wav",
      bytes: new Uint8Array([0, 0, 1, 0]),
      sampleRate: 16000,
      channels: 1,
    });

    await waitFor(async () => (await readdir(baseDir)).length > 0);
    const [sessionFolder] = await readdir(baseDir);
    const wavPath = join(baseDir, sessionFolder ?? "", "audio", "users", "user", "discord-input.wav");
    await waitFor(async () => {
      const wav = await readFile(wavPath).catch(() => undefined);
      return wav != null && wav.readUInt32LE(40) === 4;
    });

    const wav = await readFile(wavPath);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(40)).toBe(4);

    await capture.endVoiceSession();
  });
});
