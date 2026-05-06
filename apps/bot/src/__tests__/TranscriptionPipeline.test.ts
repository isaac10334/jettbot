import { describe, expect, test } from "bun:test";
import { createSignal } from "@loop-kit/common/Signal";
import { installTranscriptionPipeline } from "../transcription/installTranscriptionPipeline";
import { summarizeAssemblyAiMessage } from "../transcription/AssemblyAiTranscriptionService";
import type { TranscriptionSessionEvent } from "../transcription/TranscriptionService";

const pcm48StereoSilence = new Uint8Array(3840);

const waitForChain = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 40));
};

const emitAudio = (sidecarEvent: ReturnType<typeof createSignal<any>>, sequence: number, userId = "user"): void => {
  sidecarEvent.emit({
    type: "UserAudioChunk",
    guild_id: "guild",
    channel_id: "channel",
    session_id: "session",
    user_id: userId,
    pcm_s16le_base64: Buffer.from(pcm48StereoSilence).toString("base64"),
    sample_rate: 48000,
    channels: 2,
    timestamp_ms: sequence,
  });
};

const createRuntime = () => {
  const sidecarEvent = createSignal<any>();
  const conversationTurnReady = createSignal<any>();
  const sessionEvents: Array<(event: TranscriptionSessionEvent) => void> = [];
  const turnEvents: Array<(turn: any) => void> = [];
  const emittedTranscriptTurns: any[] = [];
  const acceptedTranscriptTurns: any[] = [];
  const sentAudio: number[] = [];
  const debugLines: Array<{ readonly path: string; readonly value: any }> = [];
  let sessionCreates = 0;

  const transcriptTurn = createSignal<any>();
  transcriptTurn.subscribe((turn) => emittedTranscriptTurns.push(turn));

  const runtime = {
    env: {
      env: {
        ASSEMBLYAI_TRANSCRIPTION_PROMPT: "",
        ASSEMBLYAI_SAMPLE_RATE: 16000,
      },
      audioNormalization: {
        createAssemblyAiNormalizer: () => ({
          normalize: (bytes: Uint8Array) => ({
            bytes: new Uint8Array(bytes.byteLength / 6),
            sampleRate: 16000 as const,
            channels: 1 as const,
            inputFrameCount: bytes.byteLength / 4,
            outputFrameCount: bytes.byteLength / 12,
          }),
          reset: () => undefined,
        }),
      },
      transcription: {
        createStreamingSession: async ({ onSessionEvent, onTurn }: { readonly onSessionEvent?: (event: TranscriptionSessionEvent) => void; readonly onTurn?: (turn: any) => void }) => {
          sessionCreates += 1;
          if (onSessionEvent) sessionEvents.push(onSessionEvent);
          if (onTurn) turnEvents.push(onTurn);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            userId: "user",
            sendAudio: (chunk: Uint8Array) => sentAudio.push(chunk.byteLength),
            close: async () => undefined,
          };
        },
      },
      transcripts: {
        acceptTurn: (turn: any) => acceptedTranscriptTurns.push(turn),
        recentContext: () => acceptedTranscriptTurns,
        conversationTurnReady,
      },
      signals: {
        sidecarEvent,
        transcriptTurn,
        conversationTurnReady: createSignal<any>(),
      },
      realtimeDebug: {
        writeJsonLine: (path: string, value: any) => debugLines.push({ path, value }),
        writeAudioChunk: () => undefined,
      },
      metrics: {
        increment: () => undefined,
      },
      discord: {
        resolveMemberProfile: async (_guildId: string, userId: string) => ({
          userId,
          username: `user-${userId}`,
          displayName: `User ${userId}`,
        }),
      },
    },
  } as any;

  installTranscriptionPipeline(runtime);
  return {
    sidecarEvent,
    sessionEvents,
    turnEvents,
    emittedTranscriptTurns,
    acceptedTranscriptTurns,
    sentAudio,
    debugLines,
    get sessionCreates() {
      return sessionCreates;
    },
  };
};

describe("installTranscriptionPipeline", () => {
  test("buffers two 20ms chunks instead of sending too-short AssemblyAI audio", async () => {
    const runtime = createRuntime();

    emitAudio(runtime.sidecarEvent, 1);
    emitAudio(runtime.sidecarEvent, 2);

    await waitForChain();
    expect(runtime.sessionCreates).toBe(0);
    expect(runtime.sentAudio).toEqual([]);
  });

  test("coalesces five 20ms chunks into one 100ms AssemblyAI packet", async () => {
    const runtime = createRuntime();

    for (let sequence = 1; sequence <= 5; sequence += 1) emitAudio(runtime.sidecarEvent, sequence);

    await waitForChain();
    expect(runtime.sessionCreates).toBe(1);
    expect(runtime.sentAudio).toEqual([3200]);
    expect(runtime.debugLines).toContainEqual({
      path: "text/audio-events.jsonl",
      value: {
        type: "assemblyai.audio_sent",
        userId: "user",
        startSequence: 1,
        endSequence: 5,
        byteLength: 3200,
        durationMs: 100,
      },
    });
  });

  test("resets closed AssemblyAI sessions so later speech can start a new session", async () => {
    const runtime = createRuntime();

    for (let sequence = 1; sequence <= 5; sequence += 1) emitAudio(runtime.sidecarEvent, sequence);
    await waitForChain();
    runtime.sessionEvents[0]?.({ type: "close", code: 3007, reason: "Input duration violation" });
    for (let sequence = 6; sequence <= 10; sequence += 1) emitAudio(runtime.sidecarEvent, sequence);

    await waitForChain();
    expect(runtime.sessionCreates).toBe(2);
    expect(runtime.sentAudio).toEqual([3200, 3200]);
  });

  test("keeps unknown SSRC transcripts diagnostic-only", async () => {
    const runtime = createRuntime();
    for (let sequence = 1; sequence <= 5; sequence += 1) emitAudio(runtime.sidecarEvent, sequence, "unknown_ssrc:1234");
    await waitForChain();

    runtime.turnEvents[0]?.({ text: "hello", isFinal: true });

    await waitForChain();
    expect(runtime.debugLines).toContainEqual({
      path: "text/transcripts.jsonl",
      value: expect.objectContaining({
        userId: "unknown_ssrc:1234",
        diagnosticSpeaker: true,
      }),
    });
    expect(runtime.emittedTranscriptTurns).toEqual([]);
  });

  test("known user transcripts include speaker metadata and stitched context", async () => {
    const runtime = createRuntime();
    for (let sequence = 1; sequence <= 5; sequence += 1) emitAudio(runtime.sidecarEvent, sequence, "123");
    await waitForChain();

    runtime.turnEvents[0]?.({ text: "hello jettbot", isFinal: true });

    await waitForChain();
    expect(runtime.acceptedTranscriptTurns).toEqual([
      expect.objectContaining({
        userId: "123",
        username: "user-123",
        displayName: "User 123",
        text: "hello jettbot",
      }),
    ]);
    expect(runtime.debugLines).toContainEqual({
      path: "text/stitched-transcripts.jsonl",
      value: expect.objectContaining({
        type: "stitched.accepted_turn",
        speaker: expect.objectContaining({
          userId: "123",
          label: "User 123",
        }),
      }),
    });
  });

  test("summarizes AssemblyAI error message details", () => {
    expect(summarizeAssemblyAiMessage({ type: "Error", error: "Input duration violation", code: 3007 })).toEqual({
      type: "message",
      messageType: "Error",
      error: "Input duration violation",
      code: 3007,
    });
  });
});
