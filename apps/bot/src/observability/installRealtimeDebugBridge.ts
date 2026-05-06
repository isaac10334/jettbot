import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";
import type { SidecarEvent, VoiceDebugEvent } from "../sidecar/RustSidecarProtocol";

const isVoiceLogEvent = (event: SidecarEvent): boolean =>
  event.type === "UserSpeakingStart" ||
  event.type === "UserSpeakingStop" ||
  event.type === "VoiceDebug" ||
  event.type === "PlaybackStarted" ||
  event.type === "PlaybackDebug" ||
  event.type === "PlaybackChunk" ||
  event.type === "PlaybackFinished";

const withEarlyMarker = (event: VoiceDebugEvent): VoiceDebugEvent & { readonly early_buffered: true } => ({
  ...event,
  early_buffered: true,
});

export const installRealtimeDebugBridge: Installer<AppEnv> = (runtime) => {
  const earlyVoiceDebug: VoiceDebugEvent[] = [];

  const writeVoiceEvent = (event: SidecarEvent): void => {
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
  };

  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type === "JoinedVoice") {
      runtime.env.realtimeDebug.startVoiceSession({
        guildId: event.guild_id,
        channelId: event.channel_id,
        sessionId: event.session_id,
      });
      writeVoiceEvent({
        type: "VoiceDebug",
        stage: "sidecar_runtime",
        message: `path=${runtime.env.env.JETTBOT_RUST_SIDECAR_PATH}`,
        guild_id: event.guild_id,
        channel_id: event.channel_id,
        session_id: event.session_id,
      });
      const remaining: VoiceDebugEvent[] = [];
      for (const item of earlyVoiceDebug) {
        if (item.session_id == null || item.session_id === event.session_id) {
          writeVoiceEvent(withEarlyMarker(item));
        } else {
          remaining.push(item);
        }
      }
      earlyVoiceDebug.length = 0;
      earlyVoiceDebug.push(...remaining);
      runtime.env.console.info("realtime_debug.session.started", {
        path: runtime.env.realtimeDebug.currentSessionPath(),
      });
      return;
    }
    if (event.type === "LeftVoice") {
      void runtime.env.realtimeDebug.endVoiceSession(event.session_id ? { sessionId: event.session_id } : undefined);
      return;
    }
    if (isVoiceLogEvent(event)) {
      if (event.type === "VoiceDebug" && runtime.env.realtimeDebug.currentSessionPath() == null) {
        earlyVoiceDebug.push(event);
        if (earlyVoiceDebug.length > 200) earlyVoiceDebug.shift();
        if (event.stage === "client_connect_mapped" || event.stage === "speaking_state_mapped") {
          runtime.env.console.info("sidecar.voice.early_debug_buffered", {
            stage: event.stage,
            sessionId: event.session_id,
            userId: event.user_id,
            ssrc: event.ssrc,
          });
        }
        return;
      }
      writeVoiceEvent(event);
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
