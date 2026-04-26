import 'dotenv/config';
import { createRunBotTask, formatStartupError } from './services';

export const runBot = async () => {
    const result = await createRunBotTask({ env: process.env })();
    if (!result.ok) {
        throw new Error(formatStartupError(result.error));
    }

    const runtime = result.value;
    const stop = async () => {
        runtime.logger.info('bot.shutdown.begin');
        await runtime.stop();
        runtime.logger.info('bot.shutdown.end', runtime.state.getSnapshot());
    };

    process.once('SIGINT', () => {
        void stop().finally(() => process.exit(0));
    });
    process.once('SIGTERM', () => {
        void stop().finally(() => process.exit(0));
    });

    runtime.logger.info('bot.started', runtime.state.getSnapshot());
    return runtime;
};
