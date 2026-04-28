import type { YoutubeService } from "../../youtube/YoutubeService";
import type { ToolDefinition } from "../ToolRegistry";

export const createYoutubeAudioTool = (youtube: YoutubeService): ToolDefinition<{ readonly query: string }, { readonly title?: string; readonly url: string; readonly status: string }> => ({
  name: "youtube_audio",
  description: "Resolve YouTube audio metadata. Playback routing is a follow-up.",
  call: async (input) => {
    const media = await youtube.resolve(input.query);
    return { ...(media.title ? { title: media.title } : {}), url: media.webpageUrl ?? media.url, status: "resolved" };
  },
});
