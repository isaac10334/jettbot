import type { VoiceService } from "../../voice/VoiceService";
import type { ToolDefinition } from "../ToolRegistry";

export const createLeaveVoiceTool = (voice: VoiceService): ToolDefinition<void, { readonly ok: true }> => ({
  name: "leave_voice",
  description: "Leave the active Discord voice channel.",
  call: async () => {
    await voice.requestLeaveVoice();
    return { ok: true };
  },
});

