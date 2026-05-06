import { createSignal } from "@loop-kit/common/Signal";
import { describe, expect, test } from "bun:test";
import type { SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { RustSidecarService } from "../sidecar/RustSidecarService";
import { createYoutubePlaybackService } from "../youtube/YoutubePlaybackService";

const media = (title: string) => ({
  title,
  mode: "search" as const,
  query: title,
  url: `https://media.test/${title}`,
  webpageUrl: `https://youtube.test/${title}`,
  durationSeconds: 60,
  playbackFormat: "wav_pcm_s16le_48000_stereo" as const,
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const guildId = "guild";

const createHarness = (options: { readonly playAudioFile?: (input: { readonly guildId: string; readonly streamId: string; readonly format: string; readonly path: string }) => Promise<void> } = {}) => {
  const sidecarEvents = createSignal<SidecarEvent>();
  const playCalls: Array<{ guildId: string; streamId: string; format: string; path: string }> = [];
  const stopCalls: string[] = [];
  const sidecar: RustSidecarService = {
    events: sidecarEvents,
    start: async () => undefined,
    sendCommand: async () => undefined,
    call: async () => undefined,
    stop: async () => undefined,
  };
  const service = createYoutubePlaybackService({
    sidecar,
    youtube: {
      resolve: async (query) => media(query),
      prepareAudioFile: async () => ({ path: "audio.wav", format: "wav_pcm_s16le_48000_stereo" }),
      getAudioStream: async () => new ReadableStream<Uint8Array>(),
      stop: async () => {
        stopCalls.push("youtube");
      },
    },
    voice: {
      state: { get: () => ({ sessions: { [guildId]: { status: "connected", guildId, channelId: "voice", sessionId: "session" } } }), set: () => undefined } as any,
      getGuildState: () => ({ status: "connected", guildId, channelId: "voice", sessionId: "session" }),
      setGuildState: () => undefined,
      requestJoinVoice: async () => undefined,
      requestLeaveVoice: async () => undefined,
      requestLeaveAllVoice: async () => undefined,
      enqueueTtsPlayback: async () => undefined,
      startPlayback: async () => undefined,
      playAudioFile: async (input) => {
        playCalls.push(input);
        if (options.playAudioFile) await options.playAudioFile(input);
      },
      stopPlayback: async (inputGuildId) => {
        stopCalls.push(`voice:${inputGuildId}`);
      },
    },
  });
  return { service, sidecarEvents, playCalls, stopCalls };
};

const waitFor = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
};

describe("YoutubePlaybackService", () => {
  test("keeps current item preparing until voice playback is playable", async () => {
    const playable = deferred<void>();
    const { service, playCalls } = createHarness({ playAudioFile: async () => playable.promise });

    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });
    await waitFor(() => playCalls.length === 1);

    expect(service.getGuildState(guildId).current?.status).toBe("preparing");
    playable.resolve();
    await waitFor(() => service.getGuildState(guildId).current?.status === "playing");
  });

  test("records last error when voice playback readiness fails", async () => {
    const { service } = createHarness({
      playAudioFile: async () => {
        throw new Error("Playback error: decoder failed");
      },
    });

    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });

    await waitFor(() => service.getGuildState(guildId).lastError === "Playback error: decoder failed");
    expect(service.getGuildState(guildId).current).toBeUndefined();
  });

  test("plays one item and advances after PlaybackFinished", async () => {
    const { service, sidecarEvents, playCalls } = createHarness();
    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });
    await waitFor(() => service.getGuildState(guildId).current?.status === "playing");

    const streamId = service.getGuildState(guildId).current?.streamId;
    expect(playCalls).toHaveLength(1);
    expect(streamId).toBeTruthy();
    sidecarEvents.emit({ type: "PlaybackFinished", stream_id: streamId ?? "", chunk_count: 0, byte_count: 1 });
    await waitFor(() => service.getGuildState(guildId).current == null);
  });

  test("queues while current item is active", async () => {
    const { service } = createHarness();
    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });
    await waitFor(() => service.getGuildState(guildId).current?.status === "playing");
    const second = await service.enqueue({ guildId, query: "second", requestedByUserId: "user" });

    expect(second.position).toBe(1);
    expect(service.getGuildState(guildId).queue.map((item) => item.media?.title)).toEqual(["second"]);
  });

  test("skip stops current playback and advances to the next item", async () => {
    const { service, stopCalls } = createHarness();
    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });
    await waitFor(() => service.getGuildState(guildId).current?.status === "playing");
    await service.enqueue({ guildId, query: "second", requestedByUserId: "user" });

    await service.skip(guildId);

    expect(stopCalls).toEqual(["voice:guild"]);
    await waitFor(() => service.getGuildState(guildId).current?.media.title === "second");
    expect(service.getGuildState(guildId).queue).toEqual([]);
  });

  test("cancelAll stops providers and clears queue", async () => {
    const { service, stopCalls } = createHarness();
    await service.enqueue({ guildId, query: "first", requestedByUserId: "user" });
    await waitFor(() => service.getGuildState(guildId).current?.status === "playing");
    await service.enqueue({ guildId, query: "second", requestedByUserId: "user" });

    await service.cancelAll(guildId);

    expect(service.getGuildState(guildId).queue).toEqual([]);
    expect(stopCalls).toEqual(["youtube", "voice:guild"]);
  });

  test("keeps playback queues isolated by guild", async () => {
    const { service, playCalls } = createHarness();
    await service.enqueue({ guildId: "guild-a", query: "first-a", requestedByUserId: "user" });
    await service.enqueue({ guildId: "guild-b", query: "first-b", requestedByUserId: "user" });

    await waitFor(() => service.getGuildState("guild-a").current?.status === "playing");
    await waitFor(() => service.getGuildState("guild-b").current?.status === "playing");

    expect(playCalls.map((call) => call.guildId).sort()).toEqual(["guild-a", "guild-b"]);
    expect(service.getGuildState("guild-a").current?.media.title).toBe("first-a");
    expect(service.getGuildState("guild-b").current?.media.title).toBe("first-b");
  });
});
