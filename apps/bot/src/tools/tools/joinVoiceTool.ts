import type { VoiceService } from "../../voice/VoiceService";
import type { ToolDefinition } from "../ToolRegistry";

export const createJoinVoiceTool = (voice: VoiceService): ToolDefinition<{ readonly guildId: string; readonly channelId: string }, { readonly ok: true }> => ({
  name: "join_voice",
  description: "Join a Discord voice channel.",
  call: async (input) => {
    await voice.requestJoinVoice(input.guildId, input.channelId);
    return { ok: true };
  },
});

