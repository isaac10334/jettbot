import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { chunkTextBySentence, streamToChunks } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";

export const installTtsPlaybackPipeline: Installer<AppEnv> = (runtime) => {
  const queue: string[] = [];
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const text = queue.shift();
        if (!text) continue;
        const chunks = chunkTextBySentence((async function* () {
          yield text;
        })());
        for await (const phrase of chunks) {
          const audio = await runtime.env.tts.synthesizeStream(phrase);
          await runtime.env.voice.enqueueTtsPlayback({
            streamId: crypto.randomUUID(),
            format: runtime.env.env.ELEVENLABS_OUTPUT_FORMAT,
            chunks: streamToChunks(audio),
          });
        }
      }
    } finally {
      running = false;
    }
  };

  const unsubscribe = runtime.env.signals.aiResponseComplete.subscribe((text) => {
    if (text.trim().length === 0) return;
    queue.push(text);
    void drain().catch((error) => {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TtsPlaybackError", message: error instanceof Error ? error.message : String(error) });
    });
  });
  return installedVoid(unsubscribe);
};

