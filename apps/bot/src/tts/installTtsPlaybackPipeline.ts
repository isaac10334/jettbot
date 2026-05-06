import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { chunkTextBySentence, streamToChunks } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";
import { resolveElevenLabsPlaybackFormat } from "./TtsOutputFormat";

interface SpeechQueueItem {
  readonly text: string;
  readonly guildId: string;
  readonly channelId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly decisionId?: string;
  readonly responseId?: string;
  readonly priority?: string;
  readonly interruptMode?: string;
}

interface GuildSpeechQueue {
  readonly queue: SpeechQueueItem[];
  running: boolean;
}

const audioExtensionForFormat = (format: string): string => {
  if (format.startsWith("mp3")) return "mp3";
  if (format.startsWith("opus")) return "opus";
  if (format.startsWith("pcm")) return "raw";
  return "bin";
};

const createPcmS16leToF32leConverter = (): ((bytes: Uint8Array) => Uint8Array) => {
  let pendingByte: number | undefined;
  return (bytes) => {
    const aligned = pendingByte == null ? bytes : Uint8Array.from([pendingByte, ...bytes]);
    pendingByte = undefined;
    const evenLength = aligned.byteLength - (aligned.byteLength % 2);
    if (evenLength !== aligned.byteLength) pendingByte = aligned[aligned.byteLength - 1];
    const evenBytes = aligned.slice(0, evenLength);
    const output = new Uint8Array(evenBytes.byteLength * 2);
    const inputView = new DataView(evenBytes.buffer, evenBytes.byteOffset, evenBytes.byteLength);
    const outputView = new DataView(output.buffer);
    for (let offset = 0; offset < evenBytes.byteLength; offset += 2) {
      outputView.setFloat32(offset * 2, inputView.getInt16(offset, true) / 32768, true);
    }
    return output;
  };
};

export const installTtsPlaybackPipeline: Installer<AppEnv> = (runtime) => {
  const guildQueues = new Map<string, GuildSpeechQueue>();

  const getGuildQueue = (guildId: string): GuildSpeechQueue => {
    const existing = guildQueues.get(guildId);
    if (existing) return existing;
    const created: GuildSpeechQueue = { queue: [], running: false };
    guildQueues.set(guildId, created);
    return created;
  };

  const drainGuild = async (guildId: string) => {
    const guildQueue = getGuildQueue(guildId);
    if (guildQueue.running) return;
    guildQueue.running = true;
    try {
      while (guildQueue.queue.length > 0) {
        const item = guildQueue.queue.shift();
        if (!item) continue;
        const { text, channelId, sessionId, turnId, decisionId, responseId } = item;
        const chunks = chunkTextBySentence((async function* () {
          yield text;
        })());
        for await (const phrase of chunks) {
          const streamId = crypto.randomUUID();
          const speechId = streamId;
          const requestedFormat = runtime.env.env.ELEVENLABS_OUTPUT_FORMAT;
          const format = resolveElevenLabsPlaybackFormat(requestedFormat);
          const extension = audioExtensionForFormat(format);
          runtime.env.conversationEngine.enqueueSpeechJob({
            guildId,
            ...(channelId ? { channelId } : {}),
            ...(turnId ? { turnId } : {}),
            ...(decisionId ? { decisionId } : {}),
            speechId,
            priority: item.priority === "high" ? "high" : "normal",
            interruptMode: item.interruptMode === "non_interruptible" || item.interruptMode === "finish_sentence_then_listen"
              ? item.interruptMode
              : "queue",
            text: phrase,
            status: "queued",
          });
          runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
            type: "tts.request.start",
            guildId,
            channelId,
            sessionId,
            turnId,
            decisionId,
            responseId,
            speechId,
            streamId,
            requestedFormat,
            format,
            formatOverridden: requestedFormat !== format,
            text: phrase,
            textLength: phrase.length,
          });
          let chunkCount = 0;
          let byteCount = 0;
          const convertDebugPcm = createPcmS16leToF32leConverter();
          const result = runtime.env.tts.synthesizeStreamWithMetadata
            ? await runtime.env.tts.synthesizeStreamWithMetadata(phrase)
            : { body: await runtime.env.tts.synthesizeStream(phrase) };
          runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
            type: "tts.response.start",
            guildId,
            channelId,
            sessionId,
            turnId,
            decisionId,
            responseId,
            speechId,
            streamId,
            format,
            status: result.status,
            contentType: result.contentType,
            requestId: result.requestId,
          });
          const instrumentedChunks = (async function* () {
            for await (const chunk of streamToChunks(result.body)) {
              chunkCount += 1;
              byteCount += chunk.byteLength;
              if (chunkCount === 1) {
                runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
                  type: "tts.first_chunk",
                  streamId,
                  speechId,
                  decisionId,
                  responseId,
                  byteLength: chunk.byteLength,
                });
              }
              runtime.env.realtimeDebug.writeAudioChunk(`tts:${streamId}:elevenlabs-output`, {
                kind: "binary",
                relativePath: `audio/tts/${streamId}-elevenlabs-output.${extension}`,
                bytes: chunk,
              });
              runtime.env.realtimeDebug.writeAudioChunk(`tts:${streamId}:sidecar-input`, {
                kind: "binary",
                relativePath: `audio/tts/${streamId}-sidecar-input.${extension}`,
                bytes: chunk,
              });
              if (format.startsWith("pcm_")) {
                runtime.env.realtimeDebug.writeAudioChunk(`tts:${streamId}:sidecar-f32le`, {
                  kind: "binary",
                  relativePath: `audio/tts/${streamId}-sidecar-f32le.raw`,
                  bytes: convertDebugPcm(chunk),
                });
              }
              yield chunk;
            }
            await runtime.env.realtimeDebug.closeAudio(`tts:${streamId}:elevenlabs-output`);
            await runtime.env.realtimeDebug.closeAudio(`tts:${streamId}:sidecar-input`);
            await runtime.env.realtimeDebug.closeAudio(`tts:${streamId}:sidecar-f32le`);
            runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
              type: "tts.playback_stream_finished",
              streamId,
              speechId,
              decisionId,
              responseId,
              chunkCount,
              byteCount,
            });
          })();
          try {
            runtime.env.conversationEngine.markSpeechStarted(guildId, speechId);
            await runtime.env.voice.enqueueTtsPlayback({
              guildId,
              streamId,
              format,
              chunks: instrumentedChunks,
            });
            runtime.env.conversationEngine.markSpeechFinished(guildId, speechId);
            runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
              type: "tts.playback.enqueue_succeeded",
              streamId,
              speechId,
              decisionId,
              responseId,
              chunkCount,
              byteCount,
            });
          } catch (error) {
            runtime.env.conversationEngine.markSpeechFailed(guildId, speechId);
            runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
              type: "tts.playback.enqueue_failed",
              streamId,
              speechId,
              decisionId,
              responseId,
              chunkCount,
              byteCount,
              error: error instanceof Error ? error.message : String(error),
            });
            runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    } finally {
      guildQueue.running = false;
    }
  };

  const unsubscribeAi = runtime.env.signals.aiResponseComplete.subscribe((response) => {
    const text = response.text;
    if (text.trim().length === 0) return;
    if (!response.guildId) {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: "Cannot play TTS without a guildId." });
      return;
    }
    const guildQueue = getGuildQueue(response.guildId);
    guildQueue.queue.push({
      text,
      guildId: response.guildId,
      ...(response.channelId ? { channelId: response.channelId } : {}),
      ...(response.sessionId ? { sessionId: response.sessionId } : {}),
      ...(response.turnId ? { turnId: response.turnId } : {}),
      ...(response.decisionId ? { decisionId: response.decisionId } : {}),
      ...(response.responseId ? { responseId: response.responseId } : {}),
      ...(response.priority ? { priority: response.priority } : {}),
      ...(response.interruptMode ? { interruptMode: response.interruptMode } : {}),
    });
    void drainGuild(response.guildId).catch((error) => {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: error instanceof Error ? error.message : String(error) });
    });
  });

  const unsubscribeDecisions = runtime.env.conversationEngine.decisions.subscribe((decision) => {
    if (decision.kind !== "interruptSelf") return;
    const guildQueue = getGuildQueue(decision.guildId);
    guildQueue.queue.splice(0);
    runtime.env.conversationEngine.interruptSelf(decision.guildId);
    runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
      type: "tts.playback.interrupt_requested",
      guildId: decision.guildId,
      decisionId: decision.id,
      turnId: decision.turnId,
      reason: decision.reason,
    });
    void runtime.env.voice.stopPlayback(decision.guildId).catch((error) => {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: error instanceof Error ? error.message : String(error) });
    });
  });

  return installedVoid(() => {
    unsubscribeAi();
    unsubscribeDecisions();
  });
};
