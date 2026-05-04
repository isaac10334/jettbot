import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { base64ToBytes } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";
import type { StreamingTranscriptionSession } from "./TranscriptionService";

export const installTranscriptionPipeline: Installer<AppEnv> = (runtime) => {
  interface UserTranscriptionRuntime {
    readonly key: string;
    readonly guildId: string;
    readonly channelId: string;
    readonly sessionId: string;
    readonly userId: string;
    readonly normalizer: ReturnType<AppEnv["audioNormalization"]["createAssemblyAiNormalizer"]>;
    session: Promise<StreamingTranscriptionSession> | undefined;
    sequence: number;
    chain: Promise<void>;
  }

  const users = new Map<string, UserTranscriptionRuntime>();

  const getUserRuntime = (input: { readonly guildId: string; readonly channelId: string; readonly sessionId: string; readonly userId: string }): UserTranscriptionRuntime => {
    const key = `${input.guildId}:${input.sessionId}:${input.userId}`;
    const existing = users.get(key);
    if (existing) return existing;
    const created: UserTranscriptionRuntime = {
      key,
      guildId: input.guildId,
      channelId: input.channelId,
      sessionId: input.sessionId,
      userId: input.userId,
      normalizer: runtime.env.audioNormalization.createAssemblyAiNormalizer(),
      session: undefined,
      sequence: 0,
      chain: Promise.resolve(),
    };
    users.set(key, created);
    return created;
  };

  const getSession = (user: UserTranscriptionRuntime): Promise<StreamingTranscriptionSession> => {
    if (user.session) return user.session;
    runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
      type: "assemblyai.session.starting",
      userId: user.userId,
      promptLength: runtime.env.env.ASSEMBLYAI_TRANSCRIPTION_PROMPT.length,
      configuredSampleRate: runtime.env.env.ASSEMBLYAI_SAMPLE_RATE,
    });
    user.session = runtime.env.transcription.createStreamingSession({
      userId: user.userId,
      prompt: runtime.env.env.ASSEMBLYAI_TRANSCRIPTION_PROMPT,
      sampleRate: runtime.env.env.ASSEMBLYAI_SAMPLE_RATE,
      onTurn: (turn) => {
        const transcriptTurn = {
          guildId: user.guildId,
          channelId: user.channelId,
          sessionId: user.sessionId,
          userId: user.userId,
          text: turn.text,
          ...(turn.startMs != null ? { startMs: turn.startMs } : {}),
          ...(turn.endMs != null ? { endMs: turn.endMs } : {}),
          isFinal: turn.isFinal,
          receivedAt: Date.now(),
        };
        runtime.env.realtimeDebug.writeJsonLine("text/transcripts.jsonl", transcriptTurn);
        runtime.env.signals.transcriptTurn.emit(transcriptTurn);
        runtime.env.transcripts.acceptTurn(transcriptTurn);
      },
    }).then((session) => {
      runtime.env.metrics.increment("transcription.session.started");
      runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
        type: "assemblyai.session.started",
        userId: user.userId,
      });
      return session;
    }).catch((error) => {
      user.session = undefined;
      runtime.env.metrics.increment("transcription.session.failed");
      throw error;
    });
    return user.session;
  };

  const unsubscribe = runtime.env.signals.sidecarEvent.subscribe((event) => {
    if (event.type !== "UserAudioChunk") return;
    const user = getUserRuntime({
      guildId: event.guild_id,
      channelId: event.channel_id,
      sessionId: event.session_id,
      userId: event.user_id,
    });
    user.sequence += 1;
    const sequence = user.sequence;
    user.chain = user.chain.then(async () => {
      const bytes = base64ToBytes(event.pcm_s16le_base64);
      const normalized = user.normalizer.normalize(bytes, {
        sampleRate: event.sample_rate,
        channels: event.channels,
      });
      runtime.env.metrics.increment("transcription.audio.raw_bytes", bytes.byteLength);
      runtime.env.metrics.increment("transcription.audio.normalized_bytes", normalized.bytes.byteLength);
      runtime.env.realtimeDebug.writeJsonLine("text/audio-events.jsonl", {
        type: "user_audio_chunk",
        guildId: event.guild_id,
        channelId: event.channel_id,
        sessionId: event.session_id,
        userId: event.user_id,
        sequence,
        byteLength: bytes.byteLength,
        sampleRate: event.sample_rate,
        channels: event.channels,
        normalizedByteLength: normalized.bytes.byteLength,
        normalizedSampleRate: normalized.sampleRate,
        normalizedChannels: normalized.channels,
        inputFrameCount: normalized.inputFrameCount,
        outputFrameCount: normalized.outputFrameCount,
        timestampMs: event.timestamp_ms,
      });
      runtime.env.realtimeDebug.writeAudioChunk(`user:${event.user_id}:discord-input`, {
        kind: "pcm_s16le",
        relativePath: `audio/users/${event.user_id}/discord-input.wav`,
        bytes,
        sampleRate: event.sample_rate,
        channels: event.channels,
      });
      runtime.env.realtimeDebug.writeAudioChunk(`user:${event.user_id}:assemblyai-input`, {
        kind: "pcm_s16le",
        relativePath: `audio/users/${event.user_id}/assemblyai-input.wav`,
        bytes: normalized.bytes,
        sampleRate: normalized.sampleRate,
        channels: normalized.channels,
      });
      const session = await getSession(user);
      session.sendAudio(normalized.bytes);
      runtime.env.realtimeDebug.writeJsonLine("text/audio-events.jsonl", {
        type: "assemblyai.audio_sent",
        userId: event.user_id,
        sequence,
        byteLength: normalized.bytes.byteLength,
      });
    }).catch((error) => {
      runtime.env.metrics.increment("transcription.audio.failed");
      runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
        type: "assemblyai.audio_failed",
        userId: event.user_id,
        sequence,
        error: error instanceof Error ? error.message : String(error),
      });
      runtime.env.signals.sidecarEvent.emit({ type: "Error", code: "TranscriptionError", message: error instanceof Error ? error.message : String(error) });
    });
  });
  const unsubscribeReady = runtime.env.transcripts.conversationTurnReady.subscribe((turn) => runtime.env.signals.conversationTurnReady.emit(turn));
  return installedVoid(async () => {
    unsubscribe();
    unsubscribeReady();
    await Promise.all([...users.values()].map((user) => user.chain.catch(() => undefined)));
    runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
      type: "assemblyai.sessions.closing",
      count: users.size,
    });
    await Promise.all([...users.values()].map(async (user) => {
      const session = await user.session?.catch(() => undefined);
      await session?.close();
      user.normalizer.reset();
    }));
  });
};
