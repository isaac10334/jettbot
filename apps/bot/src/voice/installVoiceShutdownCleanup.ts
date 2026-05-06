import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";
import type { YoutubeGuildPlaybackState } from "../youtube/YoutubePlaybackService";

const hasYoutubeWork = (state: YoutubeGuildPlaybackState): boolean =>
  Boolean(state.current) || state.queue.length > 0;

export const installVoiceShutdownCleanup: Installer<AppEnv> = (runtime) =>
  installedVoid(async () => {
    // Runtime disposal owns voice cleanup so command handlers do not need one-off shutdown paths.
    const youtubeGuildIds = Object.entries(runtime.env.youtubePlayback.state.get().guilds)
      .filter(([, state]) => hasYoutubeWork(state))
      .map(([guildId]) => guildId);

    await Promise.allSettled(youtubeGuildIds.map((guildId) => runtime.env.youtubePlayback.cancelAll(guildId)));
    await runtime.env.voice.requestLeaveAllVoice().catch((error) => {
      runtime.env.console.warn("voice.shutdown_cleanup.failed", { error });
    });
  });
