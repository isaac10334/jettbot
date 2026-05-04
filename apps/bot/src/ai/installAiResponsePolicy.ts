import { installedVoid, type Installer } from '@loop-kit/common/Runtime';
import type { AppEnv } from '../app/AppRuntime';

export const installAiResponsePolicy: Installer<AppEnv> = (runtime) => {
    const unsubscribe = runtime.env.signals.conversationTurnReady.subscribe(
        (turn) => {
            void (async () => {
                await runtime.env.memory.saveTranscriptTurn(turn);
                const messages =
                    await runtime.env.conversation.buildMessages(turn);
                const responseId = crypto.randomUUID();
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-messages.jsonl',
                    {
                        type: 'request',
                        responseId,
                        userId: turn.userId,
                        triggerTurn: turn,
                        messages,
                    },
                );
                const response = await runtime.env.ai.streamPredictedTurn({
                    userId: turn.userId,
                    messages,
                });
                for await (const partial of response.partial) {
                    runtime.env.realtimeDebug.writeJsonLine(
                        'text/llm-partial-responses.jsonl',
                        {
                            type: 'partial',
                            responseId,
                            userId: turn.userId,
                            partial,
                        },
                    );
                }
                const predictedTurn = await response.output;
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-responses.jsonl',
                    {
                        type: 'response',
                        responseId,
                        userId: turn.userId,
                        predictedTurn,
                    },
                );
                if (
                    predictedTurn.shouldSpeak &&
                    predictedTurn.speaker.trim().toLowerCase() === 'jettbot' &&
                    predictedTurn.text.trim().length > 0
                ) {
                    runtime.env.signals.aiResponseComplete.emit({
                        text: predictedTurn.text,
                        guildId: turn.guildId,
                        channelId: turn.channelId,
                        sessionId: turn.sessionId,
                    });
                }
            })().catch((error) => {
                runtime.env.signals.sidecarEvent.emit({
                    type: 'Error',
                    code: 'AiError',
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            });
        },
    );
    return installedVoid(unsubscribe);
};
