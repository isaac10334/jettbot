import type { YoutubePlaybackService } from "../../youtube/YoutubePlaybackService";
import type { VoiceService } from "../../voice/VoiceService";
import type { ToolDefinition } from "../ToolRegistry";

export interface YoutubeAudioToolResult {
  readonly title?: string;
  readonly url: string;
  readonly durationSeconds?: number;
  readonly status: "queued" | "playing";
  readonly queuePosition: number;
}

export const createYoutubeAudioTool = (
  youtubePlayback: YoutubePlaybackService,
  voice: VoiceService,
): ToolDefinition<{ readonly guildId: string; readonly query: string }, YoutubeAudioToolResult> => ({
  name: "youtube_audio",
  description: "Resolve and play YouTube audio in the active Discord voice session.",
  call: async (input) => {
    if (voice.getGuildState(input.guildId).status !== "connected") {
      throw new Error("Join a voice channel first.");
    }
    const result = await youtubePlayback.enqueue({
      guildId: input.guildId,
      query: input.query,
      requestedByUserId: "tool",
    });
    const media = result.item.media;
    return {
      ...(media?.title ? { title: media.title } : {}),
      url: media?.webpageUrl ?? media?.url ?? input.query,
      ...(media?.durationSeconds != null ? { durationSeconds: media.durationSeconds } : {}),
      status: result.position <= 1 ? "playing" : "queued",
      queuePosition: result.position,
    };
  },
});
