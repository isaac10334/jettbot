import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installVoiceSessionPolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type === "JoinedVoice") {
      runtime.env.voice.setGuildState(event.guild_id, {
        status: "connected",
        guildId: event.guild_id,
        channelId: event.channel_id,
        sessionId: event.session_id,
      });
      void runtime.env.sidecar.call({ type: "StartReceive", guild_id: event.guild_id }).catch((error) => {
        runtime.env.voice.setGuildState(event.guild_id, { status: "error", guildId: event.guild_id, message: error instanceof Error ? error.message : String(error) });
      });
    }
    if (event.type === "LeftVoice") {
      const guildId = event.guild_id;
      if (guildId) runtime.env.voice.setGuildState(guildId, { status: "disconnected", guildId });
    }
    if (event.type === "Error") {
      const connecting = Object.values(runtime.env.voice.state.get().sessions).find((value) => value.status === "connecting" || value.status === "disconnecting");
      if (connecting) runtime.env.voice.setGuildState(connecting.guildId, { status: "error", guildId: connecting.guildId, message: event.message });
    }
  });
  return installedVoid(unsubscribe);
};
