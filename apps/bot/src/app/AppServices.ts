import { createConversationService, type ConversationService } from "../ai/ConversationService";
import { createVercelAiGatewayService } from "../ai/VercelAiGatewayService";
import { createDiscordService } from "../discord/DiscordService";
import type { Env } from "../Env";
import { createTursoMemoryService } from "../memory/TursoMemoryService";
import { createLoggingService } from "../observability/LoggingService";
import { createMetricsService } from "../observability/MetricsService";
import { createRustSidecarService } from "../sidecar/RustSidecarService";
import { createAssemblyAiTranscriptionService } from "../transcription/AssemblyAiTranscriptionService";
import { createTranscriptStitcherService } from "../transcription/TranscriptStitcherService";
import { createElevenLabsTtsService } from "../tts/ElevenLabsTtsService";
import { createToolService } from "../tools/ToolService";
import { createJoinVoiceTool } from "../tools/tools/joinVoiceTool";
import { createLeaveVoiceTool } from "../tools/tools/leaveVoiceTool";
import { createPingTool } from "../tools/tools/pingTool";
import { createYoutubeAudioTool } from "../tools/tools/youtubeAudioTool";
import { createVoiceService } from "../voice/VoiceService";
import { createYtdlpYoutubeService } from "../youtube/YtdlpYoutubeService";
import { createAppSignals } from "./AppSignals";

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
  const signals = createAppSignals();
  const sidecar = createRustSidecarService(env, { console: logging.console, metrics });
  const voice = createVoiceService(sidecar);
  const discord = createDiscordService(env);
  const transcription = createAssemblyAiTranscriptionService(env);
  const transcripts = createTranscriptStitcherService();
  const memory = createTursoMemoryService(env);
  const ai = createVercelAiGatewayService(env);
  const tts = createElevenLabsTtsService(env);
  const tools = createToolService();
  const youtube = createYtdlpYoutubeService(env);
  const conversation: ConversationService = createConversationService({ transcripts, memory });

  tools.registerTool(createPingTool());
  tools.registerTool(createJoinVoiceTool(voice));
  tools.registerTool(createLeaveVoiceTool(voice));
  tools.registerTool(createYoutubeAudioTool(youtube));

  return {
    console: logging.console,
    env,
    logging,
    metrics,
    signals,
    discord,
    voice,
    sidecar,
    transcription,
    transcripts,
    ai,
    conversation,
    tts,
    memory,
    tools,
    youtube,
  };
};

export type AppServices = ReturnType<typeof createAppServices>;
