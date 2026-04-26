export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface Logger {
    child(bindings: LogContext): Logger;
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
    span(name: string, context?: LogContext): () => void;
}

const levelRank: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

export const createLogger = (options?: {
    level?: LogLevel;
    bindings?: LogContext;
}): Logger => {
    const level = options?.level ?? 'info';
    const bindings = options?.bindings ?? {};

    const shouldLog = (candidate: LogLevel) =>
        levelRank[candidate] >= levelRank[level];

    const write = (
        candidate: LogLevel,
        message: string,
        context: LogContext = {},
    ) => {
        if (!shouldLog(candidate)) return;

        const payload = {
            ts: new Date().toISOString(),
            level: candidate,
            message,
            ...bindings,
            ...context,
        };

        const line = JSON.stringify(payload);
        if (candidate === 'warn') {
            console.warn(line);
            return;
        }
        if (candidate === 'error') {
            console.error(line);
            return;
        }
        console.log(line);
    };

    return {
        child(nextBindings) {
            return createLogger({
                level,
                bindings: { ...bindings, ...nextBindings },
            });
        },
        debug(message, context) {
            write('debug', message, context);
        },
        info(message, context) {
            write('info', message, context);
        },
        warn(message, context) {
            write('warn', message, context);
        },
        error(message, context) {
            write('error', message, context);
        },
        span(name, context) {
            const startedAt = performance.now();
            write('debug', `${name}:start`, context);
            return () => {
                write('debug', `${name}:end`, {
                    ...context,
                    durationMs: Math.round(performance.now() - startedAt),
                });
            };
        },
    };
};
