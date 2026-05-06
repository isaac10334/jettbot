import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  analyzeVoiceSession,
  cleanupRealtimeSessions,
  createRealtimeCleanupPlan,
  listRealtimeSessionDirectories,
} from "../diagnostics/VoiceSessionDiagnostics";

const jsonLine = (value: unknown): string => `${JSON.stringify({ timestamp: new Date().toISOString(), value })}\n`;

const writeWav = async (path: string, input: { readonly sampleRate: number; readonly channels: number; readonly dataBytes: number }) => {
  const bytes = new Uint8Array(44 + input.dataBytes);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + input.dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * input.channels * 2, true);
  view.setUint16(32, input.channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, input.dataBytes, true);
  await writeFile(path, bytes);
};

const makeSession = async (base: string, name: string, mtime: Date) => {
  const dir = join(base, name);
  await mkdir(join(dir, "text"), { recursive: true });
  await mkdir(join(dir, "audio", "users", "123"), { recursive: true });
  await writeFile(join(dir, "text", "transcription-sessions.jsonl"), jsonLine({
    type: "assemblyai.session.event",
    event: { type: "message", messageType: "Turn", transcriptLength: 5, endOfTurn: true },
  }));
  await writeFile(join(dir, "text", "transcripts.jsonl"), jsonLine({
    guildId: "guild",
    channelId: "channel",
    sessionId: "session",
    userId: "123",
    text: "hello",
    isFinal: true,
    receivedAt: 1,
  }));
  await writeFile(join(dir, "text", "voice-events.jsonl"), [
    jsonLine({ type: "VoiceDebug", stage: "client_connect_mapped", user_id: "123", ssrc: 42 }),
    jsonLine({ type: "UserSpeakingStart", user_id: "123" }),
    jsonLine({ type: "PlaybackStarted", stream_id: "tts" }),
    jsonLine({ type: "PlaybackDebug", stream_id: "tts", stage: "playable", message: "track_state=Play" }),
    jsonLine({ type: "PlaybackFinished", stream_id: "tts" }),
  ].join(""));
  await writeFile(join(dir, "text", "llm-responses.jsonl"), jsonLine({ type: "response" }));
  await writeFile(join(dir, "text", "tts.jsonl"), jsonLine({ type: "tts.phrase" }));
  await writeWav(join(dir, "audio", "users", "123", "discord-input.wav"), { sampleRate: 48_000, channels: 2, dataBytes: 3840 });
  await writeWav(join(dir, "audio", "users", "123", "assemblyai-input.wav"), { sampleRate: 16_000, channels: 1, dataBytes: 640 });
  await utimes(dir, mtime, mtime);
  return dir;
};

describe("VoiceSessionDiagnostics", () => {
  test("analyzes latest voice session pipeline evidence", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-diag-"));
    await makeSession(base, "old", new Date("2026-05-05T08:00:00.000Z"));
    await makeSession(base, "latest", new Date("2026-05-05T09:00:00.000Z"));

    const sessions = await listRealtimeSessionDirectories(base);
    expect(sessions.map((session) => session.name)).toEqual(["latest", "old"]);

    const analysis = await analyzeVoiceSession(sessions[0]!, { includeToolVersions: false });
    expect(analysis.assemblyAi.hasTurn).toBe(true);
    expect(analysis.transcripts.knownUserIds).toEqual(["123"]);
    expect(analysis.voice.clientConnectMappedCount).toBe(1);
    expect(analysis.voice.mappedSsrcs).toEqual([42]);
    expect(analysis.playback.startedCount).toBe(1);
    expect(analysis.playback.overlappingStreamCount).toBe(0);
    expect(analysis.audio.every((item) => item.ok)).toBe(true);
    expect(analysis.missingStages).toEqual([]);
  });

  test("plans and deletes all but the latest realtime sessions", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-cleanup-"));
    await makeSession(base, "oldest", new Date("2026-05-05T07:00:00.000Z"));
    await makeSession(base, "middle", new Date("2026-05-05T08:00:00.000Z"));
    await makeSession(base, "latest", new Date("2026-05-05T09:00:00.000Z"));

    const plan = await createRealtimeCleanupPlan(base, 2);
    expect(plan.keep.map((session) => session.name)).toEqual(["latest", "middle"]);
    expect(plan.remove.map((session) => session.name)).toEqual(["oldest"]);

    await cleanupRealtimeSessions(base, 2);
    expect((await listRealtimeSessionDirectories(base)).map((session) => session.name)).toEqual(["latest", "middle"]);
  });

  test("flags AssemblyAI success with only unknown SSRC transcripts as attribution blocker", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-unknown-"));
    const dir = join(base, "5-5-26_4-21-AM_latest");
    await mkdir(join(dir, "text"), { recursive: true });
    await writeFile(join(dir, "text", "transcription-sessions.jsonl"), jsonLine({
      type: "assemblyai.session.event",
      event: { type: "message", messageType: "Turn", transcriptLength: 12, endOfTurn: true },
    }));
    await writeFile(join(dir, "text", "transcripts.jsonl"), jsonLine({
      userId: "unknown_ssrc:17603",
      text: "hello jettbot",
      isFinal: true,
      diagnosticSpeaker: true,
    }));
    await writeFile(join(dir, "text", "voice-events.jsonl"), jsonLine({
      type: "VoiceDebug",
      stage: "unknown_ssrc_audio_fallback",
      user_id: "unknown_ssrc:17603",
    }));
    await utimes(dir, new Date("2026-05-05T09:21:00.000Z"), new Date("2026-05-05T09:21:00.000Z"));

    const [session] = await listRealtimeSessionDirectories(base);
    const analysis = await analyzeVoiceSession(session!, { includeToolVersions: false });

    expect(analysis.assemblyAi.hasTurn).toBe(true);
    expect(analysis.transcripts.diagnosticCount).toBe(1);
    expect(analysis.transcripts.knownUserIds).toEqual([]);
    expect(analysis.missingStages).toEqual([
      "attribution_mapping_missing",
      "known_user_transcripts",
      "llm_response",
      "tts_stream",
      "discord_playback",
    ]);
  });

  test("counts mapped SSRC diagnostics and early buffered events", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-mapped-"));
    const dir = join(base, "mapped");
    await mkdir(join(dir, "text"), { recursive: true });
    await writeFile(join(dir, "text", "voice-events.jsonl"), [
      jsonLine({ type: "VoiceDebug", stage: "client_connect_mapped", user_id: "123", ssrc: 11, early_buffered: true }),
      jsonLine({ type: "VoiceDebug", stage: "speaking_state_mapped", user_id: "456", ssrc: 22 }),
    ].join(""));
    await utimes(dir, new Date("2026-05-05T10:01:00.000Z"), new Date("2026-05-05T10:01:00.000Z"));

    const [session] = await listRealtimeSessionDirectories(base);
    const analysis = await analyzeVoiceSession(session!, { includeToolVersions: false });

    expect(analysis.voice.clientConnectMappedCount).toBe(1);
    expect(analysis.voice.speakingStateMappedCount).toBe(1);
    expect(analysis.voice.earlyBufferedCount).toBe(1);
    expect(analysis.voice.mappedSsrcs).toEqual([11, 22]);
    expect(analysis.missingStages).not.toContain("attribution_mapping_missing");
  });

  test("treats decoded voice chunks as Discord receive evidence", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-decoded-"));
    const dir = join(base, "decoded");
    await mkdir(join(dir, "text"), { recursive: true });
    await writeFile(join(dir, "text", "voice-events.jsonl"), [
      jsonLine({ type: "VoiceDebug", stage: "decoded_voice_tick", user_id: "123", ssrc: 11 }),
      jsonLine({ type: "VoiceDebug", stage: "first_decoded_chunk", user_id: "123", ssrc: 11 }),
    ].join(""));
    await utimes(dir, new Date("2026-05-05T19:16:00.000Z"), new Date("2026-05-05T19:16:00.000Z"));

    const [session] = await listRealtimeSessionDirectories(base);
    const analysis = await analyzeVoiceSession(session!, { includeToolVersions: false });

    expect(analysis.voice.decodedVoiceTickCount).toBe(1);
    expect(analysis.voice.firstDecodedChunkCount).toBe(1);
    expect(analysis.missingStages).not.toContain("discord_receive_audio");
  });

  test("reports overlapping playback streams in the same guild", async () => {
    const base = await mkdtemp(join(tmpdir(), "jettbot-voice-overlap-"));
    const dir = join(base, "overlap");
    await mkdir(join(dir, "text"), { recursive: true });
    await writeFile(join(dir, "text", "voice-events.jsonl"), [
      `${JSON.stringify({ timestamp: "2026-05-05T20:00:00.000Z", value: { type: "PlaybackDebug", guild_id: "guild", stream_id: "a", stage: "playable", message: "track_state=Play" } })}\n`,
      `${JSON.stringify({ timestamp: "2026-05-05T20:00:00.500Z", value: { type: "PlaybackDebug", guild_id: "guild", stream_id: "b", stage: "playable", message: "track_state=Play" } })}\n`,
      `${JSON.stringify({ timestamp: "2026-05-05T20:00:01.000Z", value: { type: "PlaybackDebug", guild_id: "guild", stream_id: "a", stage: "end", message: "track_state=End" } })}\n`,
      `${JSON.stringify({ timestamp: "2026-05-05T20:00:01.500Z", value: { type: "PlaybackDebug", guild_id: "guild", stream_id: "b", stage: "end", message: "track_state=End" } })}\n`,
    ].join(""));
    await utimes(dir, new Date("2026-05-05T20:00:00.000Z"), new Date("2026-05-05T20:00:00.000Z"));

    const [session] = await listRealtimeSessionDirectories(base);
    const analysis = await analyzeVoiceSession(session!, { includeToolVersions: false });

    expect(analysis.playback.overlappingStreamCount).toBe(2);
  });
});
