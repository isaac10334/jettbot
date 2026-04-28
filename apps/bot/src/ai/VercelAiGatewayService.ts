import { streamText } from 'ai';
import type { Env } from '../Env';
import type { AiService } from './AiService';

export const createVercelAiGatewayService = (env: Env): AiService => ({
    streamResponse: async ({ userId, messages }) => {
        const result = streamText({
            model: env.AI_GATEWAY_MODEL,
            messages: [...messages],
            providerOptions: {
                gateway: {
                    user: userId,
                    tags: ['app:jettbot', 'feature:voice-response'],
                },
            },
        });
        return { text: result.textStream };
    },
});
