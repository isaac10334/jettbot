import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installRealtimeDebugBridge: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type === "JoinedVoice") {
      runtime.env.realtimeDebug.startVoiceSession({
        guildId: event.guild_id,
        channelId: event.channel_id,
        sessionId: event.session_id,
      });
      runtime.env.console.info("realtime_debug.session.started", {
        path: runtime.env.realtimeDebug.currentSessionPath(),
      });
      return;
    }
    if (event.type === "LeftVoice") {
      void runtime.env.realtimeDebug.endVoiceSession(event.session_id ? { sessionId: event.session_id } : undefined);
      return;
    }
    if (
      event.type === "UserSpeakingStart" ||
      event.type === "UserSpeakingStop" ||
      event.type === "VoiceDebug" ||
      event.type === "PlaybackStarted" ||
      event.type === "PlaybackDebug" ||
      event.type === "PlaybackChunk" ||
      event.type === "PlaybackFinished"
    ) {
      runtime.env.realtimeDebug.writeJsonLine("text/voice-events.jsonl", event);
      if (event.type === "PlaybackDebug" && (event.stage === "playable" || event.stage === "error" || event.stage === "end")) {
        const log = {
          streamId: event.stream_id,
          stage: event.stage,
          message: event.message,
          byteCount: event.byte_count,
          positionMs: event.position_ms,
        };
        if (event.stage === "error" || event.message.includes("Errored")) {
          runtime.env.console.warn("sidecar.playback.debug", log);
        } else {
          runtime.env.console.info("sidecar.playback.debug", log);
        }
      }
      return;
    }
    if (event.type === "Error") {
      runtime.env.realtimeDebug.writeJsonLine("text/errors.jsonl", event);
    }
  });

  return installedVoid(async () => {
    unsubscribe();
    await runtime.env.realtimeDebug.dispose();
  });
};
