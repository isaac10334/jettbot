import {
    createConversationService,
    type ConversationService,
} from '../ai/ConversationService';
import { createVercelAiGatewayService } from '../ai/VercelAiGatewayService';
import { createAudioNormalizationService } from '../audio/AudioNormalizationService';
import { createDiscordService } from '../discord/DiscordService';
import { createConversationEngineRuntime } from '../conversation/ConversationEngineRuntime';
import type { Env } from '../Env';
import { createBraveImageSearchService } from '../image/BraveImageSearchService';
import { createImageRateLimitService } from '../image/ImageRateLimitService';
import { createImageSearchSessionService } from '../image/ImageSearchSessionService';
import { createImageSearchTool } from '../image/imageSearchTool';
import { createTursoMemoryService } from '../memory/TursoMemoryService';
import { createLoggingService } from '../observability/LoggingService';
import { createMetricsService } from '../observability/MetricsService';
import { createRealtimeDebugCaptureService } from '../observability/RealtimeDebugCaptureService';
import { createPersonalityService } from '../personality/PersonalityService';
import { createRustSidecarService } from '../sidecar/RustSidecarService';
import { createAssemblyAiTranscriptionService } from '../transcription/AssemblyAiTranscriptionService';
import { createTranscriptStitcherService } from '../transcription/TranscriptStitcherService';
import { createElevenLabsTtsService } from '../tts/ElevenLabsTtsService';
import { createToolService } from '../tools/ToolService';
import { createJoinVoiceTool } from '../tools/tools/joinVoiceTool';
import { createLeaveVoiceTool } from '../tools/tools/leaveVoiceTool';
import { createPingTool } from '../tools/tools/pingTool';
import { createYoutubeAudioTool } from '../tools/tools/youtubeAudioTool';
import { createYoutubePlaybackService } from '../youtube/YoutubePlaybackService';
import { createVoiceService } from '../voice/VoiceService';
import { createYtdlpYoutubeService } from '../youtube/YtdlpYoutubeService';
import { createAppSignals } from './AppSignals';

export const createAppServices = (env: Env) => {
    const logging = createLoggingService({
        level: env.JETTBOT_LOG_LEVEL,
        logFilePath: env.JETTBOT_LOG_FILE_PATH,
        maxEntries: env.JETTBOT_LOG_MAX_ENTRIES,
        flushIntervalMs: env.JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS,
    });
    const metrics = createMetricsService({
        metricsFilePath: env.JETTBOT_METRICS_FILE_PATH,
        flushIntervalMs: env.JETTBOT_OBSERVABILITY_FLUSH_INTERVAL_MS,
    });
    const realtimeDebug = createRealtimeDebugCaptureService({
        enabled: env.JETTBOT_REALTIME_DEBUG_ENABLED,
        baseDir: env.JETTBOT_REALTIME_DEBUG_DIR,
    });
    const signals = createAppSignals();
    const sidecar = createRustSidecarService(env, {
        console: logging.console,
        metrics,
    });
    const audioNormalization = createAudioNormalizationService();
    const voice = createVoiceService(sidecar);
    const discord = createDiscordService(env);
    const transcription = createAssemblyAiTranscriptionService(env);
    const transcripts = createTranscriptStitcherService();
    const conversationEngine = createConversationEngineRuntime();
    const memory = createTursoMemoryService(env);
    const personality = createPersonalityService(memory);
    const ai = createVercelAiGatewayService(env);
    const tts = createElevenLabsTtsService(env);
    const tools = createToolService();
    const youtube = createYtdlpYoutubeService(env, {
        console: logging.console,
        metrics,
        realtimeDebug,
    });
    const youtubePlayback = createYoutubePlaybackService({
        youtube,
        voice,
        sidecar,
        console: logging.console,
    });
    const imageSearch = createBraveImageSearchService(env, {
        console: logging.console,
    });
    const imageRateLimits = createImageRateLimitService({
        limit: env.JETTBOT_IMAGE_SEARCH_RATE_LIMIT_COUNT,
        windowMs: env.JETTBOT_IMAGE_SEARCH_RATE_LIMIT_WINDOW_MS,
    });
    const imageSearchSessions = createImageSearchSessionService({
        defaultTtlMs: env.JETTBOT_IMAGE_SEARCH_SESSION_TTL_MS,
    });
    const conversation: ConversationService = createConversationService({
        transcripts,
        memory,
        personality,
    });

    tools.registerTool(createPingTool());
    tools.registerTool(createJoinVoiceTool(voice));
    tools.registerTool(createLeaveVoiceTool(voice));
    tools.registerTool(createYoutubeAudioTool(youtubePlayback, voice));
    tools.registerTool(createImageSearchTool(imageSearch));

    return {
        console: logging.console,
        env,
        logging,
        metrics,
        realtimeDebug,
        signals,
        discord,
        voice,
        sidecar,
        audioNormalization,
        transcription,
        transcripts,
        conversationEngine,
        ai,
        conversation,
        personality,
        tts,
        memory,
        tools,
        youtube,
        youtubePlayback,
        imageSearch,
        imageRateLimits,
        imageSearchSessions,
    };
};

export type AppServices = ReturnType<typeof createAppServices>;
