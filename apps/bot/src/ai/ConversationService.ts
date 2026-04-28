import type { MemoryService } from '../memory/MemoryService';
import type {
    TranscriptStitcherService,
    TranscriptTurn,
} from '../transcription/TranscriptStitcherService';

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
            undefined,
            undefined,
            turn.userId,
        );
        const transcriptContext = input.transcripts
            .recentContext(12)
            .map((item) => `${item.username ?? item.userId}: ${item.text}`)
            .join('\n');
        return [
            {
                role: 'system',
                content:
                    'You are Jettbot, a concise Discord voice assistant. Reply naturally for TTS. Keep responses short unless asked for detail.',
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
                content: `Conversation so far:\n${transcriptContext}\n\nRespond to ${turn.userId}: ${turn.text}`,
            },
        ];
    },
});
