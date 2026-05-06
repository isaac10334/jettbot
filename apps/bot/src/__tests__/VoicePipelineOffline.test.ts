import { createSignal } from "@loop-kit/common/Signal";
import { describe, expect, test } from "bun:test";
import { installAiResponsePolicy } from "../ai/installAiResponsePolicy";
import { installTtsPlaybackPipeline } from "../tts/installTtsPlaybackPipeline";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 1_000) throw new Error("Timed out waiting for pipeline");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const chunks = (...values: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("offline voice pipeline", () => {
  test("known final transcript drives LLM, TTS, debug artifacts, and sidecar playback", async () => {
    const conversationTurnReady = createSignal<TranscriptTurn>();
    const decisions = createSignal<any>();
    const aiResponseComplete = createSignal<any>();
    const sidecarEvent = createSignal<any>();
    const debugLines: Array<{ readonly path: string; readonly value: any }> = [];
    const audioWrites: Array<{ readonly key: string; readonly bytes: number }> = [];
    const savedTranscriptTurns: TranscriptTurn[] = [];
    const conversationInputs: TranscriptTurn[] = [];
    const ttsTexts: string[] = [];
    const playbackCalls: Array<{ readonly guildId: string; readonly streamId: string; readonly format: string; readonly bytes: number[] }> = [];

    const runtime = {
      env: {
        env: {
          ELEVENLABS_OUTPUT_FORMAT: "pcm_24000",
        },
        signals: {
          conversationTurnReady,
          aiResponseComplete,
          sidecarEvent,
        },
        memory: {
          saveTranscriptTurn: async (turn: TranscriptTurn) => {
            savedTranscriptTurns.push(turn);
          },
        },
        conversation: {
          buildMessages: async (turn: TranscriptTurn) => {
            conversationInputs.push(turn);
            return [{ role: "user" as const, content: turn.text }];
          },
        },
        ai: {
          streamPredictedTurn: async () => ({
            partial: (async function* () {
              yield { speaker: "Jettbot", shouldSpeak: true, text: "one" };
              yield { speaker: "Jettbot", shouldSpeak: true, text: "one sec" };
            })(),
            output: Promise.resolve({ speaker: "Jettbot", shouldSpeak: true, text: "one sec" }),
          }),
        },
        tts: {
          synthesizeStream: async (text: string) => {
            ttsTexts.push(text);
            return chunks(new Uint8Array([1, 2]), new Uint8Array([3, 4]));
          },
        },
        voice: {
          enqueueTtsPlayback: async (input: { readonly guildId: string; readonly streamId: string; readonly format: string; readonly chunks: AsyncIterable<Uint8Array> }) => {
            const sent: number[] = [];
            for await (const chunk of input.chunks) sent.push(chunk.byteLength);
            playbackCalls.push({ guildId: input.guildId, streamId: input.streamId, format: input.format, bytes: sent });
          },
        },
        realtimeDebug: {
          writeJsonLine: (path: string, value: any) => debugLines.push({ path, value }),
          writeAudioChunk: (key: string, input: { readonly bytes: Uint8Array }) => audioWrites.push({ key, bytes: input.bytes.byteLength }),
          closeAudio: async () => undefined,
        },
        conversationEngine: {
          decisions,
          markThinking: () => undefined,
          enqueueSpeechJob: () => undefined,
          markSpeechStarted: () => undefined,
          markSpeechFinished: () => undefined,
          markSpeechFailed: () => undefined,
          interruptSelf: () => undefined,
        },
      },
    } as any;

    installAiResponsePolicy(runtime);
    installTtsPlaybackPipeline(runtime);

    const turn: TranscriptTurn = {
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      userId: "123",
      text: "jettbot say something",
      isFinal: true,
      receivedAt: Date.now(),
    };
    decisions.emit({
      id: "decision",
      kind: "speak",
      guildId: "guild",
      channelId: "channel",
      sessionId: "session",
      turnId: "turn",
      turn,
      priority: "normal",
      interruptMode: "queue",
      reason: "test",
      createdAt: Date.now(),
      decisionStartAt: Date.now(),
      decisionFinishedAt: Date.now(),
    });

    await waitFor(() => playbackCalls.length === 1);

    expect(savedTranscriptTurns).toEqual([]);
    expect(conversationInputs).toEqual([turn]);
    expect(debugLines.some((line) => line.path === "text/llm-messages.jsonl" && line.value.type === "request")).toBe(true);
    expect(debugLines.some((line) => line.path === "text/llm-partial-responses.jsonl" && line.value.type === "partial")).toBe(true);
    expect(debugLines.some((line) => line.path === "text/llm-responses.jsonl" && line.value.predictedTurn.text === "one sec")).toBe(true);
    expect(ttsTexts).toEqual(["one sec"]);
    expect(debugLines.some((line) => line.path === "text/llm-stream.jsonl" && line.value.type === "llm.stream.finish")).toBe(true);
    expect(debugLines.some((line) => line.path === "text/tts.jsonl" && line.value.type === "tts.response.start")).toBe(true);
    expect(debugLines.some((line) => line.path === "text/tts.jsonl" && line.value.type === "tts.playback.enqueue_succeeded")).toBe(true);
    expect(audioWrites.map((item) => item.bytes)).toEqual([2, 2, 4, 2, 2, 4]);
    expect(playbackCalls[0]).toMatchObject({ guildId: "guild", format: "pcm_24000", bytes: [2, 2] });
  });

  test("overrides unsupported ElevenLabs opus output to PCM for sidecar stream playback", async () => {
    const aiResponseComplete = createSignal<any>();
    const sidecarEvent = createSignal<any>();
    const debugLines: Array<{ readonly path: string; readonly value: any }> = [];
    const playbackFormats: string[] = [];

    const runtime = {
      env: {
        env: {
          ELEVENLABS_OUTPUT_FORMAT: "opus_48000_128",
        },
        signals: {
          aiResponseComplete,
          sidecarEvent,
        },
        tts: {
          synthesizeStream: async () => chunks(new Uint8Array([1, 2])),
        },
        voice: {
          enqueueTtsPlayback: async (input: { readonly format: string; readonly chunks: AsyncIterable<Uint8Array> }) => {
            playbackFormats.push(input.format);
            for await (const _chunk of input.chunks) {
              // Drain the stream so artifact logging runs.
            }
          },
        },
        realtimeDebug: {
          writeJsonLine: (path: string, value: any) => debugLines.push({ path, value }),
          writeAudioChunk: () => undefined,
          closeAudio: async () => undefined,
        },
        conversationEngine: {
          decisions: createSignal<any>(),
          enqueueSpeechJob: () => undefined,
          markSpeechStarted: () => undefined,
          markSpeechFinished: () => undefined,
          markSpeechFailed: () => undefined,
          interruptSelf: () => undefined,
        },
      },
    } as any;

    installTtsPlaybackPipeline(runtime);
    aiResponseComplete.emit({ guildId: "guild", speaker: "Jettbot", shouldSpeak: true, text: "Hey!" });

    await waitFor(() => playbackFormats.length === 1);

    expect(playbackFormats).toEqual(["pcm_24000"]);
    expect(debugLines.some((line) =>
      line.path === "text/tts.jsonl" &&
      line.value.type === "tts.request.start" &&
      line.value.requestedFormat === "opus_48000_128" &&
      line.value.format === "pcm_24000" &&
      line.value.formatOverridden === true
    )).toBe(true);
  });

  test("serializes Jettbot speech per guild until playback ends", async () => {
    const aiResponseComplete = createSignal<any>();
    const sidecarEvent = createSignal<any>();
    const firstPlayback = deferred();
    const playbackStarts: string[] = [];

    const runtime = {
      env: {
        env: { ELEVENLABS_OUTPUT_FORMAT: "pcm_24000" },
        signals: { aiResponseComplete, sidecarEvent },
        tts: {
          synthesizeStream: async () => chunks(new Uint8Array([1, 2])),
        },
        voice: {
          enqueueTtsPlayback: async (input: { readonly streamId: string; readonly chunks: AsyncIterable<Uint8Array> }) => {
            playbackStarts.push(input.streamId);
            for await (const _chunk of input.chunks) {}
            if (playbackStarts.length === 1) await firstPlayback.promise;
          },
          stopPlayback: async () => undefined,
        },
        realtimeDebug: {
          writeJsonLine: () => undefined,
          writeAudioChunk: () => undefined,
          closeAudio: async () => undefined,
        },
        conversationEngine: {
          decisions: createSignal<any>(),
          enqueueSpeechJob: () => undefined,
          markSpeechStarted: () => undefined,
          markSpeechFinished: () => undefined,
          markSpeechFailed: () => undefined,
          interruptSelf: () => undefined,
        },
      },
    } as any;

    installTtsPlaybackPipeline(runtime);
    aiResponseComplete.emit({ guildId: "guild", text: "First." });
    aiResponseComplete.emit({ guildId: "guild", text: "Second." });

    await waitFor(() => playbackStarts.length === 1);
    firstPlayback.resolve();
    await waitFor(() => playbackStarts.length === 2);
  });

  test("allows independent speech playback in different guilds", async () => {
    const aiResponseComplete = createSignal<any>();
    const sidecarEvent = createSignal<any>();
    const playbackGuilds: string[] = [];

    const runtime = {
      env: {
        env: { ELEVENLABS_OUTPUT_FORMAT: "pcm_24000" },
        signals: { aiResponseComplete, sidecarEvent },
        tts: {
          synthesizeStream: async () => chunks(new Uint8Array([1, 2])),
        },
        voice: {
          enqueueTtsPlayback: async (input: { readonly guildId: string; readonly chunks: AsyncIterable<Uint8Array> }) => {
            playbackGuilds.push(input.guildId);
            for await (const _chunk of input.chunks) {}
            await new Promise((resolve) => setTimeout(resolve, 40));
          },
          stopPlayback: async () => undefined,
        },
        realtimeDebug: {
          writeJsonLine: () => undefined,
          writeAudioChunk: () => undefined,
          closeAudio: async () => undefined,
        },
        conversationEngine: {
          decisions: createSignal<any>(),
          enqueueSpeechJob: () => undefined,
          markSpeechStarted: () => undefined,
          markSpeechFinished: () => undefined,
          markSpeechFailed: () => undefined,
          interruptSelf: () => undefined,
        },
      },
    } as any;

    installTtsPlaybackPipeline(runtime);
    aiResponseComplete.emit({ guildId: "guild-a", text: "First." });
    aiResponseComplete.emit({ guildId: "guild-b", text: "Second." });

    await waitFor(() => playbackGuilds.length === 2);
    expect(playbackGuilds.sort()).toEqual(["guild-a", "guild-b"]);
  });

  test("failed playback advances the guild speech queue", async () => {
    const aiResponseComplete = createSignal<any>();
    const sidecarEvent = createSignal<any>();
    const playbackTexts: string[] = [];
    let attempts = 0;

    const runtime = {
      env: {
        env: { ELEVENLABS_OUTPUT_FORMAT: "pcm_24000" },
        signals: { aiResponseComplete, sidecarEvent },
        tts: {
          synthesizeStream: async (text: string) => chunks(new TextEncoder().encode(text)),
        },
        voice: {
          enqueueTtsPlayback: async (input: { readonly chunks: AsyncIterable<Uint8Array> }) => {
            attempts += 1;
            let text = "";
            for await (const chunk of input.chunks) text += new TextDecoder().decode(chunk);
            playbackTexts.push(text);
            if (attempts === 1) throw new Error("playback failed");
          },
          stopPlayback: async () => undefined,
        },
        realtimeDebug: {
          writeJsonLine: () => undefined,
          writeAudioChunk: () => undefined,
          closeAudio: async () => undefined,
        },
        conversationEngine: {
          decisions: createSignal<any>(),
          enqueueSpeechJob: () => undefined,
          markSpeechStarted: () => undefined,
          markSpeechFinished: () => undefined,
          markSpeechFailed: () => undefined,
          interruptSelf: () => undefined,
        },
      },
    } as any;

    installTtsPlaybackPipeline(runtime);
    aiResponseComplete.emit({ guildId: "guild", text: "First." });
    aiResponseComplete.emit({ guildId: "guild", text: "Second." });

    await waitFor(() => playbackTexts.length === 2);
    expect(playbackTexts).toEqual(["First.", "Second."]);
  });
});
