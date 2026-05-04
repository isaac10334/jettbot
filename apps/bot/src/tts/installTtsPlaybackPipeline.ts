import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { chunkTextBySentence, streamToChunks } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";

const audioExtensionForFormat = (format: string): string => {
  if (format.startsWith("mp3")) return "mp3";
  if (format.startsWith("opus")) return "opus";
  if (format.startsWith("pcm")) return "raw";
  return "bin";
};

export const installTtsPlaybackPipeline: Installer<AppEnv> = (runtime) => {
  const queue: Array<{ readonly text: string; readonly guildId: string; readonly channelId?: string; readonly sessionId?: string }> = [];
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        const { text, guildId, channelId, sessionId } = item;
        const chunks = chunkTextBySentence((async function* () {
          yield text;
        })());
        for await (const phrase of chunks) {
          const streamId = crypto.randomUUID();
          const format = runtime.env.env.ELEVENLABS_OUTPUT_FORMAT;
          const extension = audioExtensionForFormat(format);
          runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
            type: "tts.phrase",
            guildId,
            channelId,
            sessionId,
            streamId,
            format,
            text: phrase,
          });
          const audio = await runtime.env.tts.synthesizeStream(phrase);
          const instrumentedChunks = (async function* () {
            for await (const chunk of streamToChunks(audio)) {
              runtime.env.realtimeDebug.writeAudioChunk(`tts:${streamId}:elevenlabs-output`, {
                kind: "binary",
                relativePath: `audio/tts/${streamId}-elevenlabs-output.${extension}`,
                bytes: chunk,
              });
              runtime.env.realtimeDebug.writeAudioChunk(`tts:${streamId}:discord-input`, {
                kind: "binary",
                relativePath: `audio/tts/${streamId}-discord-input.${extension}`,
                bytes: chunk,
              });
              yield chunk;
            }
            await runtime.env.realtimeDebug.closeAudio(`tts:${streamId}:elevenlabs-output`);
            await runtime.env.realtimeDebug.closeAudio(`tts:${streamId}:discord-input`);
            runtime.env.realtimeDebug.writeJsonLine("text/tts.jsonl", {
              type: "tts.playback_stream_finished",
              streamId,
            });
          })();
          await runtime.env.voice.enqueueTtsPlayback({
            guildId,
            streamId,
            format,
            chunks: instrumentedChunks,
          });
        }
      }
    } finally {
      running = false;
    }
  };

  const unsubscribe = runtime.env.signals.aiResponseComplete.subscribe((response) => {
    const text = response.text;
    if (text.trim().length === 0) return;
    if (!response.guildId) {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: "Cannot play TTS without a guildId." });
      return;
    }
    queue.push({ text, guildId: response.guildId, ...(response.channelId ? { channelId: response.channelId } : {}), ...(response.sessionId ? { sessionId: response.sessionId } : {}) });
    void drain().catch((error) => {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: error instanceof Error ? error.message : String(error) });
    });
  });
  return installedVoid(unsubscribe);
};
