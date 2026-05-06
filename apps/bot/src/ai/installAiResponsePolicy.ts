import { installedVoid, type Installer } from '@loop-kit/common/Runtime';
import type { AppEnv } from '../app/AppRuntime';

export const installAiResponsePolicy: Installer<AppEnv> = (runtime) => {
    const unsubscribe = runtime.env.conversationEngine.decisions.subscribe(
        (decision) => {
            void (async () => {
                if (decision.kind !== 'speak' && decision.kind !== 'queueSpeech') return;
                const turn = decision.turn;
                if (!turn) return;
                runtime.env.conversationEngine.markThinking(decision.guildId);
                await runtime.env.memory.saveTranscriptTurn(turn);
                const messages =
                    await runtime.env.conversation.buildMessages(turn);
                const responseId = crypto.randomUUID();
                const llmStartAt = Date.now();
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-messages.jsonl',
                    {
                        type: 'request',
                        responseId,
                        decisionId: decision.id,
                        turnId: decision.turnId,
                        userId: turn.userId,
                        triggerTurn: turn,
                        decision,
                        messages,
                    },
                );
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-stream.jsonl',
                    {
                        type: 'llm.stream.start',
                        responseId,
                        decisionId: decision.id,
                        turnId: decision.turnId,
                        userId: turn.userId,
                        decisionFinishToLlmStartMs: llmStartAt - decision.decisionFinishedAt,
                    },
                );
                const response = await runtime.env.ai.streamPredictedTurn({
                    userId: turn.userId,
                    messages,
                });
                let partialCount = 0;
                let firstTextPartialAt: number | undefined;
                for await (const partial of response.partial) {
                    partialCount += 1;
                    const text = typeof partial.text === 'string' ? partial.text : '';
                    if (firstTextPartialAt == null && text.length > 0) firstTextPartialAt = Date.now();
                    runtime.env.realtimeDebug.writeJsonLine(
                        'text/llm-partial-responses.jsonl',
                        {
                            type: 'partial',
                            responseId,
                            decisionId: decision.id,
                            turnId: decision.turnId,
                            userId: turn.userId,
                            partialCount,
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
                        decisionId: decision.id,
                        turnId: decision.turnId,
                        userId: turn.userId,
                        predictedTurn,
                    },
                );
                const llmFinishedAt = Date.now();
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-stream.jsonl',
                    {
                        type: 'llm.stream.finish',
                        responseId,
                        decisionId: decision.id,
                        turnId: decision.turnId,
                        userId: turn.userId,
                        partialCount,
                        shouldSpeak: predictedTurn.shouldSpeak,
                        speaker: predictedTurn.speaker,
                        textLength: predictedTurn.text.length,
                        llmDurationMs: llmFinishedAt - llmStartAt,
                        ...(firstTextPartialAt == null ? {} : { llmStartToFirstTextPartialMs: firstTextPartialAt - llmStartAt }),
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
                        decisionId: decision.id,
                        priority: decision.priority,
                        interruptMode: decision.interruptMode,
                        responseId,
                        ...(decision.turnId ? { turnId: decision.turnId } : {}),
                    });
                }
            })().catch((error) => {
                runtime.env.realtimeDebug.writeJsonLine(
                    'text/llm-stream.jsonl',
                    {
                        type: 'llm.stream.error',
                        decisionId: decision.id,
                        turnId: decision.turnId,
                        userId: decision.turn?.userId,
                        error:
                            error instanceof Error ? error.message : String(error),
                    },
                );
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
