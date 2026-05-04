import { createSignal, type Signal } from "@loop-kit/common/Signal";
import { createStore, type Store } from "@loop-kit/common/Store";
import type { Console } from "@loop-kit/common/Console";
import type { SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { RustSidecarService } from "../sidecar/RustSidecarService";
import type { VoiceService } from "../voice/VoiceService";
import type { YoutubeMedia, YoutubeService } from "./YoutubeService";

export interface YoutubeQueueItem {
  readonly id: string;
  readonly guildId: string;
  readonly query: string;
  readonly requestedByUserId: string;
  readonly requestedInChannelId?: string;
  readonly media?: YoutubeMedia;
}

export interface YoutubeNowPlaying extends YoutubeQueueItem {
  readonly media: YoutubeMedia;
  readonly streamId?: string;
  readonly status: "preparing" | "playing" | "stopping" | "failed";
  readonly error?: string;
  readonly startedAtMs?: number;
}

export interface YoutubePlaybackState {
  readonly guilds: Readonly<Record<string, YoutubeGuildPlaybackState>>;
}

export interface YoutubeGuildPlaybackState {
  readonly current: YoutubeNowPlaying | undefined;
  readonly queue: readonly YoutubeQueueItem[];
  readonly lastError: string | undefined;
  readonly uiMessage: {
    readonly channelId: string;
    readonly messageId: string;
  } | undefined;
}

export interface YoutubeEnqueueResult {
  readonly item: YoutubeQueueItem;
  readonly position: number;
  readonly state: YoutubePlaybackState;
}

export interface YoutubePlaybackService {
  readonly state: Store<YoutubePlaybackState>;
  readonly changed: Signal<YoutubePlaybackState>;
  readonly getGuildState: (guildId: string) => YoutubeGuildPlaybackState;
  readonly enqueue: (input: {
    readonly guildId: string;
    readonly query: string;
    readonly requestedByUserId: string;
    readonly requestedInChannelId?: string;
  }) => Promise<YoutubeEnqueueResult>;
  readonly skip: (guildId: string) => Promise<void>;
  readonly cancelAll: (guildId: string) => Promise<void>;
  readonly handleSidecarEvent: (event: SidecarEvent) => void;
}

interface PendingTrack {
  readonly guildId: string;
  readonly streamId: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const mediaTitle = (media: YoutubeMedia): string => media.title ?? media.webpageUrl ?? media.url;

export const createYoutubePlaybackService = (input: {
  readonly youtube: YoutubeService;
  readonly voice: VoiceService;
  readonly sidecar: RustSidecarService;
  readonly console?: Console;
}): YoutubePlaybackService => {
  const emptyGuildState = (): YoutubeGuildPlaybackState => ({ current: undefined, queue: [], lastError: undefined, uiMessage: undefined });
  const state = createStore<YoutubePlaybackState>({ guilds: {} });
  const changed = createSignal<YoutubePlaybackState>();
  const running = new Set<string>();
  const pendingTracks = new Map<string, PendingTrack>();

  const publish = (next: YoutubePlaybackState): YoutubePlaybackState => {
    state.set(next);
    changed.emit(next);
    return next;
  };

  const update = (fn: (value: YoutubePlaybackState) => YoutubePlaybackState): YoutubePlaybackState => publish(fn(state.get()));
  const getGuildState = (guildId: string): YoutubeGuildPlaybackState => state.get().guilds[guildId] ?? emptyGuildState();
  const updateGuild = (guildId: string, fn: (value: YoutubeGuildPlaybackState) => YoutubeGuildPlaybackState): YoutubePlaybackState =>
    update((value) => ({ ...value, guilds: { ...value.guilds, [guildId]: fn(value.guilds[guildId] ?? emptyGuildState()) } }));

  const waitForTrackEnd = (guildId: string, streamId: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      pendingTracks.set(streamId, { guildId, streamId, resolve: () => resolve(), reject });
    }).finally(() => {
      pendingTracks.delete(streamId);
    });

  const playLoop = async (guildId: string): Promise<void> => {
    if (running.has(guildId)) return;
    running.add(guildId);
    try {
      while (getGuildState(guildId).queue.length > 0) {
        const queued = getGuildState(guildId).queue[0];
        if (!queued) break;
        const rest = getGuildState(guildId).queue.slice(1);
        try {
          const media = queued.media ?? await input.youtube.resolve(queued.query);
          updateGuild(guildId, (value) => ({
            ...value,
            current: { ...queued, media, status: "preparing" },
            queue: rest,
            lastError: undefined,
          }));
          const audio = await input.youtube.prepareAudioFile(media);
          const streamId = crypto.randomUUID();
          updateGuild(guildId, (value) => ({
            ...value,
            current: {
              ...queued,
              media,
              streamId,
              status: "preparing",
            },
          }));
          await input.voice.playAudioFile({ guildId, streamId, format: audio.format, path: audio.path });
          if (getGuildState(guildId).current?.id !== queued.id || getGuildState(guildId).current?.status !== "preparing") continue;
          updateGuild(guildId, (value) => ({
            ...value,
            current: value.current?.id === queued.id && value.current.status === "preparing"
              ? {
                  ...value.current,
                  status: "playing",
                  startedAtMs: Date.now(),
                }
              : value.current,
          }));
          await waitForTrackEnd(guildId, streamId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          input.console?.error("youtube.playback.failed", { error });
          updateGuild(guildId, (value) => ({
            ...value,
            current: value.current ? { ...value.current, status: "failed", error: message } : undefined,
            lastError: message,
          }));
        } finally {
          updateGuild(guildId, (value) => ({ ...value, current: undefined }));
        }
      }
    } finally {
      running.delete(guildId);
      if (getGuildState(guildId).queue.length > 0) void playLoop(guildId);
    }
  };

  const service: YoutubePlaybackService = {
    state,
    changed,
    getGuildState,
    enqueue: async ({ guildId, query, requestedByUserId, requestedInChannelId }) => {
      const media = await input.youtube.resolve(query);
      const item: YoutubeQueueItem = {
        id: crypto.randomUUID(),
        guildId,
        query,
        requestedByUserId,
        ...(requestedInChannelId ? { requestedInChannelId } : {}),
        media,
      };
      const next = updateGuild(guildId, (value) => ({ ...value, queue: [...value.queue, item], lastError: undefined }));
      void playLoop(guildId);
      const current = next.guilds[guildId]?.current;
      const isCurrent = current?.id === item.id;
      const position = isCurrent ? 0 : (next.guilds[guildId]?.queue.findIndex((value) => value.id === item.id) ?? -1) + 1;
      return { item, position, state: next };
    },
    skip: async (guildId) => {
      const current = getGuildState(guildId).current;
      if (!current) return;
      updateGuild(guildId, (value) => ({
        ...value,
        current: value.current ? { ...value.current, status: "stopping" } : undefined,
      }));
      if (current.streamId) pendingTracks.get(current.streamId)?.resolve();
      await input.voice.stopPlayback(guildId);
    },
    cancelAll: async (guildId) => {
      const current = getGuildState(guildId).current;
      updateGuild(guildId, (value) => ({
        ...value,
        current: value.current ? { ...value.current, status: "stopping" } : undefined,
        queue: [],
      }));
      if (current?.streamId) pendingTracks.get(current.streamId)?.resolve();
      await input.youtube.stop();
      await input.voice.stopPlayback(guildId);
    },
    handleSidecarEvent: (event) => {
      if (event.type !== "PlaybackFinished" && event.type !== "PlaybackDebug") return;
      const pending = pendingTracks.get(event.stream_id);
      if (!pending) return;
      if (event.type === "PlaybackFinished" && event.stream_id === pending.streamId) {
        pending.resolve();
      }
      if (event.type === "PlaybackDebug" && event.stream_id === pending.streamId && event.stage === "error") {
        pending.reject(new Error(event.message));
      }
    },
  };

  input.sidecar.events.subscribe(service.handleSidecarEvent);
  return service;
};

export const summarizeYoutubePlayback = (state: YoutubeGuildPlaybackState): string => {
  const current = state.current;
  if (!current) return state.queue.length > 0 ? `Queued: ${state.queue.length}` : "Idle";
  return `${current.status}: ${mediaTitle(current.media)} (${state.queue.length} queued)`;
};
