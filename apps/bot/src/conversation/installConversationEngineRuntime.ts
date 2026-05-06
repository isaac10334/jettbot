import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installConversationEngineRuntime: Installer<AppEnv> = (runtime) => {
  const unsubscribePartialTranscript = runtime.env.signals.transcriptTurn.subscribe((turn) => {
    if (turn.isFinal) return;
    const decision = runtime.env.conversationEngine.ingestTranscriptTurn(turn);
    runtime.env.realtimeDebug.writeJsonLine("text/conversation-engine.jsonl", {
      type: "conversation.decision",
      decision,
    });
  });

  const unsubscribeTranscript = runtime.env.signals.conversationTurnReady.subscribe((turn) => {
    const decision = runtime.env.conversationEngine.ingestTranscriptTurn(turn);
    runtime.env.realtimeDebug.writeJsonLine("text/conversation-engine.jsonl", {
      type: "conversation.decision",
      decision,
    });
  });

  const unsubscribeSidecar = runtime.env.signals.sidecarEvent.subscribe((event) => {
    runtime.env.conversationEngine.ingestPlaybackEvent(event);
    if (event.type === "PlaybackDebug" || event.type === "PlaybackFinished" || event.type === "PlaybackStarted") {
      runtime.env.realtimeDebug.writeJsonLine("text/conversation-engine.jsonl", {
        type: "conversation.playback_event",
        event,
      });
    }
  });

  return installedVoid(() => {
    unsubscribePartialTranscript();
    unsubscribeTranscript();
    unsubscribeSidecar();
  });
};
