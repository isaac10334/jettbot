import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { base64ToBytes } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";
import type { StreamingTranscriptionSession } from "./TranscriptionService";

export const installTranscriptionPipeline: Installer<AppEnv> = (runtime) => {
  const sessions = new Map<string, StreamingTranscriptionSession>();
  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type !== "UserAudioChunk") return;
    void (async () => {
      let session = sessions.get(event.user_id);
      if (!session) {
        session = await runtime.env.transcription.createStreamingSession({
          userId: event.user_id,
          prompt: runtime.env.env.ASSEMBLYAI_TRANSCRIPTION_PROMPT,
          sampleRate: runtime.env.env.ASSEMBLYAI_SAMPLE_RATE,
          onTurn: (turn) => {
            const transcriptTurn = {
              userId: event.user_id,
              text: turn.text,
              ...(turn.startMs != null ? { startMs: turn.startMs } : {}),
              ...(turn.endMs != null ? { endMs: turn.endMs } : {}),
              isFinal: turn.isFinal,
              receivedAt: Date.now(),
            };
            runtime.env.signals.transcriptTurn.emit(transcriptTurn);
            runtime.env.transcripts.acceptTurn(transcriptTurn);
          },
        });
        sessions.set(event.user_id, session);
      }
      session.sendAudio(base64ToBytes(event.pcm_s16le_base64));
    })().catch((error) => {
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TranscriptionError", message: error instanceof Error ? error.message : String(error) });
    });
  });
  const unsubscribeReady = runtime.env.transcripts.conversationTurnReady.subscribe((turn) => runtime.env.signals.conversationTurnReady.emit(turn));
  return installedVoid(async () => {
    unsubscribe();
    unsubscribeReady();
    await Promise.all([...sessions.values()].map((session) => session.close()));
  });
};
