import type { VoiceService } from '../../voice/VoiceService';
import type { ToolDefinition } from '../ToolRegistry';

export const createLeaveVoiceTool = (
    voice: VoiceService,
): ToolDefinition<{ readonly guildId: string }, { readonly ok: true }> => ({
    name: 'leave_voice',
    description: 'Leave the active Discord voice channel.',
    call: async (input) => {
        await voice.requestLeaveVoice(input.guildId);
        return { ok: true };
    },
});
