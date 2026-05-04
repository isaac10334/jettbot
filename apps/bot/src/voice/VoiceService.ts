import { createStore, type Store } from "@loop-kit/common/Store";
import type { RustSidecarService } from "../sidecar/RustSidecarService";
import type { VoiceGuildState, VoiceState } from "./VoiceSignals";

export interface VoiceService {
  readonly state: Store<VoiceState>;
  readonly getGuildState: (guildId: string) => VoiceGuildState;
  readonly setGuildState: (guildId: string, guildState: VoiceGuildState) => void;
  readonly requestJoinVoice: (guildId: string, channelId: string) => Promise<void>;
  readonly requestLeaveVoice: (guildId: string) => Promise<void>;
  readonly enqueueTtsPlayback: (input: { readonly guildId: string; readonly streamId: string; readonly format: string; readonly chunks: AsyncIterable<Uint8Array> }) => Promise<void>;
  readonly startPlayback: (input: { readonly guildId: string; readonly streamId: string; readonly format: string; readonly chunks: AsyncIterable<Uint8Array>; readonly pace?: boolean }) => Promise<void>;
  readonly playAudioFile: (input: { readonly guildId: string; readonly streamId: string; readonly format: string; readonly path: string }) => Promise<void>;
  readonly stopPlayback: (guildId: string) => Promise<void>;
}

interface PcmPlaybackFormat {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bytesPerSecond: number;
}

const playbackChunkDurationMs = 100;
const playbackLeadMs = 500;
const playbackReadyTimeoutMs = 5_000;

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const parsePcmPlaybackFormat = (format: string): PcmPlaybackFormat | undefined => {
  const short = format.match(/^pcm_(\d+)$/);
  if (short) {
    const sampleRate = Number(short[1]);
    return { sampleRate, channels: 1, bytesPerSecond: sampleRate * 2 };
  }

  const detailed = format.match(/^pcm_s16le_(\d+)_(mono|stereo)$/);
  if (detailed) {
    const sampleRate = Number(detailed[1]);
    const channels = detailed[2] === "stereo" ? 2 : 1;
    return { sampleRate, channels, bytesPerSecond: sampleRate * channels * 2 };
  }

  return undefined;
};

async function* coalescePcmChunks(chunks: AsyncIterable<Uint8Array>, targetBytes: number): AsyncIterable<Uint8Array> {
  let pending = new Uint8Array(0);
  for await (const chunk of chunks) {
    const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
    combined.set(pending, 0);
    combined.set(chunk, pending.byteLength);
    let offset = 0;
    while (combined.byteLength - offset >= targetBytes) {
      yield combined.slice(offset, offset + targetBytes);
      offset += targetBytes;
    }
    pending = combined.slice(offset);
  }
  if (pending.byteLength > 0) yield pending;
}

export const createVoiceService = (sidecar: RustSidecarService): VoiceService => {
  const state = createStore<VoiceState>({ sessions: {} });
  const getGuildState = (guildId: string): VoiceGuildState => state.get().sessions[guildId] ?? { status: "disconnected", guildId };
  const setGuildState = (guildId: string, guildState: VoiceGuildState): void => {
    state.set({ sessions: { ...state.get().sessions, [guildId]: guildState } });
  };

  const waitForPlaybackReady = async (streamId: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for playback to become playable: ${streamId}`));
      }, playbackReadyTimeoutMs);
      const unsubscribe = sidecar.events.subscribe((event) => {
        if (event.type !== "PlaybackDebug" || event.stream_id !== streamId) return;
        if (event.stage === "playable") {
          clearTimeout(timer);
          unsubscribe();
          resolve();
          return;
        }
        if (event.stage === "error" || event.stage === "end") {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(`Playback ${event.stage}: ${event.message}`));
        }
      });
    });
  };

  const drainPlayback = async ({
    streamId,
    format,
    chunks,
    pace,
  }: {
    readonly streamId: string;
    readonly format: string;
    readonly chunks: AsyncIterable<Uint8Array>;
    readonly pace?: boolean;
  }): Promise<void> => {
    const pcm = pace ? parsePcmPlaybackFormat(format) : undefined;
    const pacedChunks = pcm
      ? coalescePcmChunks(chunks, Math.max(2, Math.floor((pcm.bytesPerSecond * playbackChunkDurationMs) / 1_000)))
      : chunks;
    const startMs = performance.now();
    let sentBytes = 0;
    try {
      for await (const chunk of pacedChunks) {
        await sidecar.call({ type: "PlayAudioStreamChunk", stream_id: streamId, bytes_base64: Buffer.from(chunk).toString("base64") }, 30_000);
        if (pcm) {
          sentBytes += chunk.byteLength;
          const mediaMsSent = (sentBytes / pcm.bytesPerSecond) * 1_000;
          const targetElapsedMs = Math.max(0, mediaMsSent - playbackLeadMs);
          await sleep(targetElapsedMs - (performance.now() - startMs));
        }
      }
    } finally {
      await sidecar.call({ type: "PlayAudioStreamEnd", stream_id: streamId }).catch(() => undefined);
    }
  };

  return {
    state,
    getGuildState,
    setGuildState,
    requestJoinVoice: async (guildId, channelId) => {
      setGuildState(guildId, { status: "connecting", guildId, channelId });
      try {
        await sidecar.call({ type: "JoinVoice", guild_id: guildId, channel_id: channelId });
      } catch (error) {
        setGuildState(guildId, { status: "error", guildId, message: `JoinVoice failed: ${error instanceof Error ? error.message : String(error)}` });
        throw error;
      }
    },
    requestLeaveVoice: async (guildId) => {
      const current = getGuildState(guildId);
      setGuildState(guildId, {
        status: "disconnecting",
        guildId,
        ...(current.status === "connected" ? { sessionId: current.sessionId } : {}),
      });
      try {
        await sidecar.call({ type: "LeaveVoice", guild_id: guildId });
      } catch (error) {
        setGuildState(guildId, { status: "error", guildId, message: `LeaveVoice failed: ${error instanceof Error ? error.message : String(error)}` });
        throw error;
      }
    },
    enqueueTtsPlayback: async ({ guildId, streamId, format, chunks }) => {
      await sidecar.call({ type: "PlayAudioStreamBegin", guild_id: guildId, stream_id: streamId, format });
      await drainPlayback({ streamId, format, chunks });
    },
    startPlayback: async ({ guildId, streamId, format, chunks, pace }) => {
      await sidecar.call({ type: "PlayAudioStreamBegin", guild_id: guildId, stream_id: streamId, format });
      void drainPlayback({ streamId, format, chunks, ...(pace == null ? {} : { pace }) }).catch(() => undefined);
    },
    playAudioFile: async ({ guildId, streamId, format, path }) => {
      await sidecar.call({ type: "PlayAudioFile", guild_id: guildId, stream_id: streamId, format, path }, 30_000);
      await waitForPlaybackReady(streamId);
    },
    stopPlayback: async (guildId) => {
      await sidecar.call({ type: "StopPlayback", guild_id: guildId });
    },
  };
};
