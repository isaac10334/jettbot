import { Output, streamText } from 'ai';
import { z } from 'zod';
import type { Env } from '../Env';
import type { AiService } from './AiService';

const predictedTurnSchema = z.object({
    speaker: z.string().min(1),
    shouldSpeak: z.boolean(),
    text: z.string(),
});

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
    streamPredictedTurn: async ({ userId, messages }) => {
        const result = streamText({
            model: env.AI_GATEWAY_MODEL,
            messages: [...messages],
            output: Output.object({ schema: predictedTurnSchema }),
            providerOptions: {
                gateway: {
                    user: userId,
                    tags: ['app:jettbot', 'feature:voice-response-simulation'],
                },
            },
        });
        return {
            partial: result.partialOutputStream,
            output: Promise.resolve(result.output),
        };
    },
});
