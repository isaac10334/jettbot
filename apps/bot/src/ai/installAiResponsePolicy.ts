import { installedVoid, type Installer } from '@loop-kit/common/Runtime';
import type { AppEnv } from '../app/AppRuntime';

export const installAiResponsePolicy: Installer<AppEnv> = (runtime) => {
    const unsubscribe = runtime.env.signals.conversationTurnReady.subscribe(
        (turn) => {
            void (async () => {
                await runtime.env.memory.saveTranscriptTurn(turn);
                const messages =
                    await runtime.env.conversation.buildMessages(turn);
                const response = await runtime.env.ai.streamResponse({
                    userId: turn.userId,
                    messages,
                });
                let text = '';
                for await (const token of response.text) {
                    text += token;
                    runtime.env.signals.aiToken.emit(token);
                }
                runtime.env.signals.aiResponseComplete.emit(text);
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
