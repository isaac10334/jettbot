import { createStore, type Store } from "@loop-kit/common/Store";
import type { RustSidecarService } from "../sidecar/RustSidecarService";
import type { VoiceState } from "./VoiceSignals";

export interface VoiceService {
  readonly state: Store<VoiceState>;
  readonly requestJoinVoice: (guildId: string, channelId: string) => Promise<void>;
  readonly requestLeaveVoice: () => Promise<void>;
  readonly enqueueTtsPlayback: (input: { readonly streamId: string; readonly format: string; readonly chunks: AsyncIterable<Uint8Array> }) => Promise<void>;
  readonly stopPlayback: () => Promise<void>;
}

export const createVoiceService = (sidecar: RustSidecarService): VoiceService => {
  const state = createStore<VoiceState>({ status: "disconnected" });

  return {
    state,
    requestJoinVoice: async (guildId, channelId) => {
      state.set({ status: "connecting", guildId, channelId });
      await sidecar.call({ type: "JoinVoice", guild_id: guildId, channel_id: channelId });
    },
    requestLeaveVoice: async () => {
      const current = state.get();
      state.set({
        status: "disconnecting",
        ...(current.status === "connected" ? { sessionId: current.sessionId } : {}),
      });
      await sidecar.call({ type: "LeaveVoice" });
    },
    enqueueTtsPlayback: async ({ streamId, format, chunks }) => {
      await sidecar.call({ type: "PlayAudioStreamBegin", stream_id: streamId, format });
      for await (const chunk of chunks) {
        await sidecar.call({ type: "PlayAudioStreamChunk", stream_id: streamId, bytes_base64: Buffer.from(chunk).toString("base64") }, 30_000);
      }
      await sidecar.call({ type: "PlayAudioStreamEnd", stream_id: streamId });
    },
    stopPlayback: async () => {
      await sidecar.call({ type: "StopPlayback" });
    },
  };
};
