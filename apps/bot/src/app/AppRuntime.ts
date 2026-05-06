import { createRuntime, type Runtime } from '@loop-kit/common/Runtime';
import { installAiResponsePolicy } from '../ai/installAiResponsePolicy';
import { installDiscordCommands } from '../discord/installDiscordCommands';
import { installDiscordGateway } from '../discord/installDiscordGateway';
import { installDiscordImagePolicy } from '../image/installDiscordImagePolicy';
import { installDiscordMessagePolicy } from '../discord/installDiscordMessagePolicy';
import { installDiscordVoiceCommandPolicy } from '../discord/installDiscordVoiceCommandPolicy';
import { installConversationEngineRuntime } from '../conversation/installConversationEngineRuntime';
import type { Env } from '../Env';
import { installMemoryEffects } from '../memory/installMemoryEffects';
import { installObservability } from '../observability/installObservability';
import { installRealtimeDebugBridge } from '../observability/installRealtimeDebugBridge';
import { installRustSidecarBridge } from '../sidecar/installRustSidecarBridge';
import { installTranscriptionPipeline } from '../transcription/installTranscriptionPipeline';
import { installTtsPlaybackPipeline } from '../tts/installTtsPlaybackPipeline';
import { installVoiceShutdownCleanup } from '../voice/installVoiceShutdownCleanup';
import { installVoiceSessionPolicy } from '../voice/installVoiceSessionPolicy';
import { createAppServices, type AppServices } from './AppServices';
import { installShutdownHandlers } from './installShutdownHandlers';

export interface AppEnv extends AppServices {}

export interface AppRuntime {
    readonly runtime: Runtime<AppEnv>;
    readonly start: () => Promise<void>;
    readonly dispose: () => Promise<void>;
}

export const createAppRuntime = (env: Env): AppRuntime => {
    const services = createAppServices(env);
    const runtime = createRuntime<AppEnv>(services);
    return {
        runtime,
        start: async () => {
            await runtime.installAll([
                installObservability,
                installShutdownHandlers,
                installMemoryEffects,
                installRustSidecarBridge,
                installVoiceShutdownCleanup,
                installRealtimeDebugBridge,
                installDiscordGateway,
                installDiscordCommands,
                installVoiceSessionPolicy,
                installTranscriptionPipeline,
                installConversationEngineRuntime,
                installAiResponsePolicy,
                installTtsPlaybackPipeline,
                installDiscordVoiceCommandPolicy,
                installDiscordImagePolicy,
                installDiscordMessagePolicy,
            ]);
        },
        dispose: async () => {
            await runtime.dispose();
        },
    };
};
