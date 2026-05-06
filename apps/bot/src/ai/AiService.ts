export interface AiResponseStream {
    readonly text: AsyncIterable<string>;
}

export interface AiPredictedTurn {
    readonly speaker: string;
    readonly shouldSpeak: boolean;
    readonly text: string;
}

export interface AiPredictedTurnStream {
    readonly partial: AsyncIterable<Partial<AiPredictedTurn>>;
    readonly output: Promise<AiPredictedTurn>;
}

export interface AiService {
    readonly streamResponse: (input: {
        readonly userId: string;
        readonly messages: readonly {
            readonly role: 'system' | 'user' | 'assistant';
            readonly content: string;
        }[];
    }) => Promise<AiResponseStream>;
    readonly streamPredictedTurn: (input: {
        readonly userId: string;
        readonly messages: readonly {
            readonly role: 'system' | 'user' | 'assistant';
            readonly content: string;
        }[];
    }) => Promise<AiPredictedTurnStream>;
}
