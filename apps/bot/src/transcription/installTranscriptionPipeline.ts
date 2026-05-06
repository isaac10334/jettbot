import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { base64ToBytes } from "../__internal/StreamUtils";
import type { AppEnv } from "../app/AppRuntime";
import type { StreamingTranscriptionSession } from "./TranscriptionService";

const assemblyAiBytesPerMs = 16_000 * 1 * 2 / 1_000;
const assemblyAiTargetPacketMs = 100;
const assemblyAiMinimumPacketMs = 50;
const assemblyAiTargetPacketBytes = assemblyAiBytesPerMs * assemblyAiTargetPacketMs;
const assemblyAiMinimumPacketBytes = assemblyAiBytesPerMs * assemblyAiMinimumPacketMs;

interface PendingAssemblyAiAudio {
  bytes: Uint8Array;
  startSequence: number | undefined;
  endSequence: number | undefined;
}

const appendPendingAudio = (pending: PendingAssemblyAiAudio, bytes: Uint8Array, sequence: number): void => {
  const combined = new Uint8Array(pending.bytes.byteLength + bytes.byteLength);
  combined.set(pending.bytes, 0);
  combined.set(bytes, pending.bytes.byteLength);
  pending.bytes = combined;
  pending.startSequence = pending.startSequence ?? sequence;
  pending.endSequence = sequence;
};

const takePendingAudio = (pending: PendingAssemblyAiAudio, byteLength: number): { readonly bytes: Uint8Array; readonly startSequence?: number; readonly endSequence?: number } => {
  const bytes = pending.bytes.slice(0, byteLength);
  const startSequence = pending.startSequence;
  const endSequence = pending.endSequence;
  pending.bytes = pending.bytes.slice(byteLength);
  if (pending.bytes.byteLength === 0) {
    pending.startSequence = undefined;
    pending.endSequence = undefined;
  }
  return { bytes, ...(startSequence != null ? { startSequence } : {}), ...(endSequence != null ? { endSequence } : {}) };
};

const packetDurationMs = (byteLength: number): number => byteLength / assemblyAiBytesPerMs;

const isUnknownSsrcUser = (userId: string): boolean => userId.startsWith("unknown_ssrc:");

interface TranscriptSpeakerProfile {
  readonly userId: string;
  readonly username?: string;
  readonly displayName?: string;
}

const speakerLabel = (profile: TranscriptSpeakerProfile): string =>
  profile.displayName ?? profile.username ?? profile.userId;

export const installTranscriptionPipeline: Installer<AppEnv> = (runtime) => {
  interface UserTranscriptionRuntime {
    readonly key: string;
    readonly guildId: string;
    readonly channelId: string;
    readonly sessionId: string;
    readonly userId: string;
    readonly normalizer: ReturnType<AppEnv["audioNormalization"]["createAssemblyAiNormalizer"]>;
    session: Promise<StreamingTranscriptionSession> | undefined;
    sessionGeneration: number;
    sequence: number;
    chain: Promise<void>;
    pendingAssemblyAiAudio: PendingAssemblyAiAudio;
    profile: TranscriptSpeakerProfile;
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
      sessionGeneration: 0,
      sequence: 0,
      chain: Promise.resolve(),
      pendingAssemblyAiAudio: { bytes: new Uint8Array(0), startSequence: undefined, endSequence: undefined },
      profile: { userId: input.userId },
    };
    users.set(key, created);
    if (!isUnknownSsrcUser(input.userId) && runtime.env.discord?.resolveMemberProfile) {
      void runtime.env.discord.resolveMemberProfile(input.guildId, input.userId).then((profile) => {
        created.profile = profile;
        runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
          type: "speaker.profile.resolved",
          userId: input.userId,
          username: profile.username,
          displayName: profile.displayName,
        });
      }).catch((error) => {
        runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
          type: "speaker.profile.failed",
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
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
    user.sessionGeneration += 1;
    const sessionGeneration = user.sessionGeneration;
    user.session = runtime.env.transcription.createStreamingSession({
      userId: user.userId,
      prompt: runtime.env.env.ASSEMBLYAI_TRANSCRIPTION_PROMPT,
      sampleRate: runtime.env.env.ASSEMBLYAI_SAMPLE_RATE,
      onSessionEvent: (event) => {
        runtime.env.realtimeDebug.writeJsonLine("text/transcription-sessions.jsonl", {
          type: "assemblyai.session.event",
          userId: user.userId,
          event,
        });
        if ((event.type === "close" || event.type === "error") && user.sessionGeneration === sessionGeneration) {
          user.session = undefined;
          user.pendingAssemblyAiAudio = { bytes: new Uint8Array(0), startSequence: undefined, endSequence: undefined };
        }
      },
      onTurn: (turn) => {
        const diagnosticSpeaker = isUnknownSsrcUser(user.userId);
        const transcriptTurn = {
          guildId: user.guildId,
          channelId: user.channelId,
          sessionId: user.sessionId,
          userId: user.userId,
          ...(user.profile.username ? { username: user.profile.username } : {}),
          ...(user.profile.displayName ? { displayName: user.profile.displayName } : {}),
          text: turn.text,
          ...(turn.startMs != null ? { startMs: turn.startMs } : {}),
          ...(turn.endMs != null ? { endMs: turn.endMs } : {}),
          isFinal: turn.isFinal,
          receivedAt: Date.now(),
          ...(diagnosticSpeaker ? { diagnosticSpeaker } : {}),
        };
        runtime.env.realtimeDebug.writeJsonLine("text/transcripts.jsonl", transcriptTurn);
        if (diagnosticSpeaker) return;
        runtime.env.signals.transcriptTurn.emit(transcriptTurn);
        runtime.env.transcripts.acceptTurn(transcriptTurn);
        runtime.env.realtimeDebug.writeJsonLine("text/stitched-transcripts.jsonl", {
          type: "stitched.accepted_turn",
          trigger: transcriptTurn,
          speaker: {
            userId: user.profile.userId,
            label: speakerLabel(user.profile),
            username: user.profile.username,
            displayName: user.profile.displayName,
          },
          context: runtime.env.transcripts.recentContext(12).map((item) => ({
            userId: item.userId,
            username: item.username,
            displayName: item.displayName,
            label: speakerLabel(item),
            text: item.text,
            isFinal: item.isFinal,
            receivedAt: item.receivedAt,
          })),
        });
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

  const sendAssemblyAiPacket = async (
    user: UserTranscriptionRuntime,
    packet: { readonly bytes: Uint8Array; readonly startSequence?: number; readonly endSequence?: number },
  ): Promise<void> => {
    const session = await getSession(user);
    try {
      session.sendAudio(packet.bytes);
    } catch (error) {
      user.session = undefined;
      user.pendingAssemblyAiAudio = { bytes: new Uint8Array(0), startSequence: undefined, endSequence: undefined };
      throw error;
    }
    runtime.env.realtimeDebug.writeJsonLine("text/audio-events.jsonl", {
      type: "assemblyai.audio_sent",
      userId: user.userId,
      ...(packet.startSequence != null ? { startSequence: packet.startSequence } : {}),
      ...(packet.endSequence != null ? { endSequence: packet.endSequence } : {}),
      byteLength: packet.bytes.byteLength,
      durationMs: packetDurationMs(packet.bytes.byteLength),
    });
  };

  const drainReadyAssemblyAiPackets = async (user: UserTranscriptionRuntime): Promise<void> => {
    while (user.pendingAssemblyAiAudio.bytes.byteLength >= assemblyAiTargetPacketBytes) {
      await sendAssemblyAiPacket(user, takePendingAudio(user.pendingAssemblyAiAudio, assemblyAiTargetPacketBytes));
    }
  };

  const flushAssemblyAiTail = async (user: UserTranscriptionRuntime): Promise<void> => {
    const pendingBytes = user.pendingAssemblyAiAudio.bytes.byteLength;
    if (pendingBytes === 0) return;
    if (pendingBytes < assemblyAiMinimumPacketBytes) {
      runtime.env.realtimeDebug.writeJsonLine("text/audio-events.jsonl", {
        type: "assemblyai.audio_dropped_short_tail",
        userId: user.userId,
        ...(user.pendingAssemblyAiAudio.startSequence != null ? { startSequence: user.pendingAssemblyAiAudio.startSequence } : {}),
        ...(user.pendingAssemblyAiAudio.endSequence != null ? { endSequence: user.pendingAssemblyAiAudio.endSequence } : {}),
        byteLength: pendingBytes,
        durationMs: packetDurationMs(pendingBytes),
      });
      user.pendingAssemblyAiAudio = { bytes: new Uint8Array(0), startSequence: undefined, endSequence: undefined };
      return;
    }
    await sendAssemblyAiPacket(user, takePendingAudio(user.pendingAssemblyAiAudio, pendingBytes));
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
      appendPendingAudio(user.pendingAssemblyAiAudio, normalized.bytes, sequence);
      await drainReadyAssemblyAiPackets(user);
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
    await Promise.all([...users.values()].map((user) => flushAssemblyAiTail(user).catch(() => undefined)));
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
