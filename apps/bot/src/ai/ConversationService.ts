import type { MemoryService } from '../memory/MemoryService';
import type {
    TranscriptStitcherService,
    TranscriptTurn,
} from '../transcription/TranscriptStitcherService';

const speakerLabel = (turn: TranscriptTurn): string =>
    turn.displayName ?? turn.username ?? turn.userId;

export interface ConversationService {
    readonly buildMessages: (
        turn: TranscriptTurn,
    ) => Promise<
        readonly {
            readonly role: 'system' | 'user' | 'assistant';
            readonly content: string;
        }[]
    >;
}

export const createConversationService = (input: {
    readonly transcripts: TranscriptStitcherService;
    readonly memory: MemoryService;
}): ConversationService => ({
    buildMessages: async (turn) => {
        const recentMemory = await input.memory.getRecentConversation(
            turn.guildId,
            turn.channelId,
            turn.userId,
        );
        const transcriptContext = input.transcripts
            .recentContext(12)
            .map((item) => `${speakerLabel(item)} (${item.userId}): ${item.text}`)
            .join('\n');
        return [
            {
                role: 'system',
                content:
                    'You simulate the next single turn in a Discord voice conversation. Return exactly one likely next turn as structured data. The speaker can be any participant or Jettbot. Use speaker "Jettbot" only when Jettbot should actually speak. Keep Jettbot text concise and natural for TTS.',
            },
            ...(recentMemory.length > 0
                ? [
                      {
                          role: 'system' as const,
                          content: `Recent memory:\n${recentMemory.map((m) => m.text).join('\n')}`,
                      },
                  ]
                : []),
            {
                role: 'user',
                content: `Conversation so far:\n${transcriptContext}\n\nMost recent final turn: ${speakerLabel(turn)} (${turn.userId}): ${turn.text}\n\nPredict the next single turn.`,
            },
        ];
    },
});
