import { describe, expect, test } from "bun:test";
import { createSignal } from "@loop-kit/common/Signal";
import { installTranscriptionPipeline } from "../transcription/installTranscriptionPipeline";

const pcm48StereoSilence = new Uint8Array(3840);

describe("installTranscriptionPipeline", () => {
  test("creates one AssemblyAI session for rapid same-user chunks", async () => {
    const sidecarEvent = createSignal<any>();
    const conversationTurnReady = createSignal<any>();
    let sessionCreates = 0;
    const sentAudio: number[] = [];

    const runtime = {
      env: {
        env: {
          ASSEMBLYAI_TRANSCRIPTION_PROMPT: "",
          ASSEMBLYAI_SAMPLE_RATE: 16000,
        },
        audioNormalization: {
          createAssemblyAiNormalizer: () => {
            const pending: number[] = [];
            return {
              normalize: (bytes: Uint8Array) => {
                pending.push(bytes.byteLength);
                return {
                  bytes: new Uint8Array(bytes.byteLength / 6),
                  sampleRate: 16000 as const,
                  channels: 1 as const,
                  inputFrameCount: bytes.byteLength / 4,
                  outputFrameCount: bytes.byteLength / 12,
                };
              },
              reset: () => {
                pending.length = 0;
              },
            };
          },
        },
        transcription: {
          createStreamingSession: async () => {
            sessionCreates += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
              userId: "user",
              sendAudio: (chunk: Uint8Array) => sentAudio.push(chunk.byteLength),
              close: async () => undefined,
            };
          },
        },
        transcripts: {
          acceptTurn: () => undefined,
          conversationTurnReady,
        },
        signals: {
          sidecarEvent,
          transcriptTurn: createSignal<any>(),
          conversationTurnReady: createSignal<any>(),
        },
        realtimeDebug: {
          writeJsonLine: () => undefined,
          writeAudioChunk: () => undefined,
        },
        metrics: {
          increment: () => undefined,
        },
      },
    } as any;

    installTranscriptionPipeline(runtime);
    sidecarEvent.emit({
      type: "UserAudioChunk",
      guild_id: "guild",
      channel_id: "channel",
      session_id: "session",
      user_id: "user",
      pcm_s16le_base64: Buffer.from(pcm48StereoSilence).toString("base64"),
      sample_rate: 48000,
      channels: 2,
      timestamp_ms: 1,
    });
    sidecarEvent.emit({
      type: "UserAudioChunk",
      guild_id: "guild",
      channel_id: "channel",
      session_id: "session",
      user_id: "user",
      pcm_s16le_base64: Buffer.from(pcm48StereoSilence).toString("base64"),
      sample_rate: 48000,
      channels: 2,
      timestamp_ms: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sessionCreates).toBe(1);
    expect(sentAudio).toEqual([640, 640]);
  });
});
