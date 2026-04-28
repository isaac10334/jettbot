import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installVoiceSessionPolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type === "JoinedVoice") {
      runtime.env.voice.state.set({
        status: "connected",
        guildId: event.guild_id,
        channelId: event.channel_id,
        sessionId: event.session_id,
      });
      void runtime.env.sidecar.call({ type: "StartReceive" }).catch((error) => {
        runtime.env.voice.state.set({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    }
    if (event.type === "LeftVoice") {
      runtime.env.voice.state.set({ status: "disconnected" });
    }
    if (event.type === "Error") {
      runtime.env.voice.state.set({ status: "error", message: event.message });
    }
  });
  return installedVoid(unsubscribe);
};

