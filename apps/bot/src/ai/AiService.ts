export interface AiResponseStream {
    readonly text: AsyncIterable<string>;
}

export interface AiService {
    readonly streamResponse: (input: {
        readonly userId: string;
        readonly messages: readonly {
            readonly role: 'system' | 'user' | 'assistant';
            readonly content: string;
        }[];
    }) => Promise<AiResponseStream>;
}
