import type { Result, Task } from '@evolu/common';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { VoiceRuntime } from '../discord/voiceRuntime';
import { joinVoiceRuntime } from '../discord/voiceRuntime';
import { VoiceSessionActor } from '../bot/VoiceSessionActor';
import type { BotConfig, ConfigError } from './config';
import { readConfig } from './config';
import { err, ok, toTask } from './fp';
import { createLogger, type Logger } from './logging';
import { createBotStateStore, type BotStateStore } from './state';

export type StartupError =
    | ConfigError
    | { readonly type: 'DiscordLoginFailed'; readonly cause: unknown }
    | { readonly type: 'GuildFetchFailed'; readonly cause: unknown }
    | { readonly type: 'VoiceConnectFailed'; readonly cause: unknown };

export type RunningBot = {
    readonly config: BotConfig;
    readonly logger: Logger;
    readonly state: BotStateStore;
    readonly client: Client;
    readonly voiceRuntime: VoiceRuntime;
    readonly session: VoiceSessionActor;
    stop(): Promise<void>;
};

export type AppDeps = {
    readonly env: NodeJS.ProcessEnv;
    readonly logger?: Logger;
};

const createDiscordClient = () =>
    new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
        partials: [Partials.Channel],
    });

const connectDiscord = (
    config: BotConfig,
    logger: Logger,
): Task<Client, StartupError> =>
    toTask(async () => {
        const client = createDiscordClient();
        try {
            await client.login(config.discordToken);
        } catch (cause) {
            return err({ type: 'DiscordLoginFailed', cause });
        }

        client.once(Events.ClientReady, () => {
            logger.info('discord.client.ready', {
                botUser: client.user?.tag ?? null,
            });
        });

        return ok(client);
    });

const connectVoiceRuntime = (
    client: Client,
    config: BotConfig,
): Task<VoiceRuntime, StartupError> =>
    toTask(async () => {
        try {
            const guild = await client.guilds.fetch(config.guildId);
            const voiceRuntime = await joinVoiceRuntime({
                guild,
                channelId: config.voiceChannelId,
                selfDeaf: true,
                selfMute: false,
            });
            return ok(voiceRuntime);
        } catch (cause) {
            const type =
                cause instanceof Error &&
                /guild/i.test(cause.message) &&
                !/voice/i.test(cause.message)
                    ? 'GuildFetchFailed'
                    : 'VoiceConnectFailed';
            return err({ type, cause } as StartupError);
        }
    });

export const createRunBotTask = (deps: AppDeps): Task<RunningBot, StartupError> =>
    toTask(async () => {
        const config = readConfig(deps.env);
        if (!config.ok) return config;

        const logger =
            deps.logger ??
            createLogger({
                level: config.value.logLevel,
                bindings: {
                    app: 'jettbot',
                    guildId: config.value.guildId,
                    voiceChannelId: config.value.voiceChannelId,
                },
            });

        const state = createBotStateStore({
            guildId: config.value.guildId,
            voiceChannelId: config.value.voiceChannelId,
            connectedMemberIds: [],
        });

        state.updateClient({
            status: 'connecting',
        });

        const client = await connectDiscord(config.value, logger)();
        if (!client.ok) return client;

        const voiceRuntime = await connectVoiceRuntime(client.value, config.value)();
        if (!voiceRuntime.ok) {
            client.value.destroy();
            return voiceRuntime;
        }

        const session = new VoiceSessionActor(
            voiceRuntime.value,
            client.value,
            config.value.guildId,
            config.value.voiceChannelId,
            {
                debug: config.value.debug,
                targetFrames: config.value.targetFrames,
                maxFrames: config.value.maxFrames,
                resubscribeAfterMs: config.value.resubscribeAfterMs,
                outputSilenceWhenEmpty: true,
                logger,
                state,
            },
        );

        session.setLoopbackMode({ kind: 'mix_all' });
        await session.start();

        state.updateClient({
            status: 'running',
        });

        return ok({
            config: config.value,
            logger,
            state,
            client: client.value,
            voiceRuntime: voiceRuntime.value,
            session,
            async stop() {
                state.updateClient({ status: 'stopped' });
                session.stop();
                voiceRuntime.value.destroy();
                client.value.destroy();
            },
        });
    });

export const formatStartupError = (error: StartupError): string => {
    switch (error.type) {
        case 'MissingEnvVar':
            return `Missing required environment variable: ${error.key}`;
        case 'InvalidEnvVar':
            return `Invalid environment variable ${error.key}: ${error.message}`;
        case 'DiscordLoginFailed':
            return `Discord login failed: ${String(error.cause)}`;
        case 'GuildFetchFailed':
            return `Failed to fetch guild: ${String(error.cause)}`;
        case 'VoiceConnectFailed':
            return `Failed to connect to Discord voice: ${String(error.cause)}`;
    }
};
