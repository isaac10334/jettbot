import type { Result } from '@evolu/common';
import { err, fromNullable, isSome, ok } from './fp';
import type { LogLevel } from './logging';

export type ConfigError =
    | { readonly type: 'MissingEnvVar'; readonly key: string }
    | {
          readonly type: 'InvalidEnvVar';
          readonly key: string;
          readonly message: string;
      };

export type BotConfig = {
    readonly discordToken: string;
    readonly guildId: string;
    readonly voiceChannelId: string;
    readonly debug: boolean;
    readonly logLevel: LogLevel;
    readonly targetFrames: number;
    readonly maxFrames: number;
    readonly resubscribeAfterMs: number;
};

const requireEnv = (
    env: NodeJS.ProcessEnv,
    key: string,
): Result<string, ConfigError> => {
    const value = fromNullable(env[key]?.trim());
    if (!isSome(value) || value.value.length === 0) {
        return err({ type: 'MissingEnvVar', key });
    }
    return ok(value.value);
};

const parsePositiveInt = (
    env: NodeJS.ProcessEnv,
    key: string,
    fallback: number,
): Result<number, ConfigError> => {
    const raw = env[key]?.trim();
    if (!raw) return ok(fallback);

    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value <= 0) {
        return err({
            type: 'InvalidEnvVar',
            key,
            message: `Expected a positive integer, received ${raw}`,
        });
    }
    return ok(value);
};

const parseLogLevel = (
    env: NodeJS.ProcessEnv,
): Result<LogLevel, ConfigError> => {
    const raw = env.LOG_LEVEL?.trim();
    if (!raw) return ok(env.DEBUG && env.DEBUG !== '0' ? 'debug' : 'info');

    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error')
        return ok(raw);

    return err({
        type: 'InvalidEnvVar',
        key: 'LOG_LEVEL',
        message: `Expected debug|info|warn|error, received ${raw}`,
    });
};

export const readConfig = (
    env: NodeJS.ProcessEnv,
): Result<BotConfig, ConfigError> => {
    const discordToken = requireEnv(env, 'DISCORD_TOKEN');
    if (!discordToken.ok) return discordToken;

    const guildId = requireEnv(env, 'GUILD_ID');
    if (!guildId.ok) return guildId;

    const voiceChannelId = requireEnv(env, 'VOICE_CHANNEL_ID');
    if (!voiceChannelId.ok) return voiceChannelId;

    const targetFrames = parsePositiveInt(env, 'TARGET_FRAMES', 25);
    if (!targetFrames.ok) return targetFrames;

    const maxFrames = parsePositiveInt(env, 'MAX_FRAMES', 200);
    if (!maxFrames.ok) return maxFrames;

    const resubscribeAfterMs = parsePositiveInt(
        env,
        'RESUBSCRIBE_AFTER_MS',
        2_000,
    );
    if (!resubscribeAfterMs.ok) return resubscribeAfterMs;

    const logLevel = parseLogLevel(env);
    if (!logLevel.ok) return logLevel;

    return ok({
        discordToken: discordToken.value,
        guildId: guildId.value,
        voiceChannelId: voiceChannelId.value,
        debug: env.DEBUG === '1' || env.DEBUG === 'true',
        logLevel: logLevel.value,
        targetFrames: targetFrames.value,
        maxFrames: maxFrames.value,
        resubscribeAfterMs: resubscribeAfterMs.value,
    });
};
