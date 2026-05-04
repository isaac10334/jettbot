import { describe, expect, test } from "bun:test";
import type { Env } from "../Env";
import { __youtubeTestUtils, createYtdlpYoutubeService } from "../youtube/YtdlpYoutubeService";

const env = {
  YTDLP_PATH: "yt-dlp",
  FFMPEG_PATH: "ffmpeg",
} as Env;

const streamFromText = (value: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });

const emptyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

const writable = (): WritableStream<Uint8Array> =>
  new WritableStream<Uint8Array>({
    write: () => undefined,
  });

describe("YtdlpYoutubeService", () => {
  test("classifies http URLs as URL targets", () => {
    expect(__youtubeTestUtils.createYoutubeResolveTarget("https://www.youtube.com/watch?v=abc")).toEqual({
      mode: "url",
      query: "https://www.youtube.com/watch?v=abc",
      target: "https://www.youtube.com/watch?v=abc",
    });
  });

  test("classifies generic https URLs as URL targets", () => {
    expect(__youtubeTestUtils.createYoutubeResolveTarget("https://example.com/video")).toEqual({
      mode: "url",
      query: "https://example.com/video",
      target: "https://example.com/video",
    });
  });

  test("classifies plain text as one-result yt-dlp search", () => {
    expect(__youtubeTestUtils.createYoutubeResolveTarget(" death grips get got ")).toEqual({
      mode: "search",
      query: "death grips get got",
      target: "ytsearch1:death grips get got",
    });
  });

  test("rejects empty queries", () => {
    expect(() => __youtubeTestUtils.createYoutubeResolveTarget("   ")).toThrow("YouTube query cannot be empty.");
  });

  test("builds resolve command with search target", async () => {
    const mutableCalls: string[][] = [];
    const service = createYtdlpYoutubeService(env, {
      spawn: (options) => {
        mutableCalls.push([...options.cmd]);
        return {
          stdout: streamFromText(JSON.stringify({ title: "Death Grips - Get Got", webpage_url: "https://youtube.test/watch?v=1", duration: 172 })),
          stderr: emptyStream(),
          exited: Promise.resolve(0),
          kill: () => undefined,
        };
      },
    });

    const media = await service.resolve("death grips get got");
    expect(media.mode).toBe("search");
    expect(media.playbackFormat).toBe("wav_pcm_s16le_48000_stereo");
    expect(mutableCalls).toEqual([["yt-dlp", "--dump-json", "--no-playlist", "ytsearch1:death grips get got"]]);
  });

  test("includes cookies when configured", async () => {
    const calls: string[][] = [];
    const service = createYtdlpYoutubeService({ ...env, YOUTUBE_COOKIES_PATH: "./cookies.txt" } as Env, {
      spawn: (options) => {
        calls.push([...options.cmd]);
        return {
          stdout: streamFromText(JSON.stringify({ webpage_url: "https://youtube.test/watch?v=1" })),
          stderr: emptyStream(),
          exited: Promise.resolve(0),
          kill: () => undefined,
        };
      },
    });

    await service.resolve("https://youtube.test/watch?v=1");
    expect(calls[0]).toEqual(["yt-dlp", "--cookies", "./cookies.txt", "--dump-json", "--no-playlist", "https://youtube.test/watch?v=1"]);
  });

  test("builds yt-dlp to ffmpeg streaming pipeline", async () => {
    const calls: string[][] = [];
    const service = createYtdlpYoutubeService(env, {
      spawn: (options) => {
        calls.push([...options.cmd]);
        const outputIndex = options.cmd.indexOf("-o");
        const exited = outputIndex >= 0
          ? Bun.write(String(options.cmd[outputIndex + 1]).replace("%(ext)s", "webm"), new Uint8Array([1, 2, 3])).then(() => 0)
          : Promise.resolve(0);
        return {
          stdout: emptyStream(),
          stderr: emptyStream(),
          ...(options.stdin === "pipe" ? { stdin: writable() } : {}),
          exited,
          kill: () => undefined,
        };
      },
    });

    await service.getAudioStream({
      mode: "url",
      query: "https://youtube.test/watch?v=1",
      url: "https://media.test/audio",
      webpageUrl: "https://youtube.test/watch?v=1",
      playbackFormat: "wav_pcm_s16le_48000_stereo",
    });

    expect(calls).toEqual([
      expect.arrayContaining(["yt-dlp", "-f", "bestaudio", "--no-playlist", "-o", expect.stringContaining("audio.%(ext)s"), "https://youtube.test/watch?v=1"]),
      expect.arrayContaining(["ffmpeg", "-loglevel", "warning", "-i", expect.stringContaining("audio.webm"), "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1"]),
    ]);
  });

  test("stop kills active ffmpeg process after download", async () => {
    const killed: string[] = [];
    const service = createYtdlpYoutubeService(env, {
      spawn: (options) => ({
        stdout: emptyStream(),
        stderr: emptyStream(),
        ...(options.stdin === "pipe" ? { stdin: writable() } : {}),
        exited: options.cmd[0] === "yt-dlp"
          ? new Promise((resolve) => {
              const outputIndex = options.cmd.indexOf("-o");
              void Bun.write(String(options.cmd[outputIndex + 1]).replace("%(ext)s", "webm"), new Uint8Array([1, 2, 3])).then(() => resolve(0));
            })
          : new Promise((resolve) => setTimeout(() => resolve(0), 1)),
        kill: () => {
          killed.push(options.cmd[0] ?? "unknown");
        },
      }),
    });

    await service.getAudioStream({
      mode: "url",
      query: "https://youtube.test/watch?v=1",
      url: "https://media.test/audio",
      webpageUrl: "https://youtube.test/watch?v=1",
      playbackFormat: "wav_pcm_s16le_48000_stereo",
    });
    await service.stop();

    expect(killed).toContain("ffmpeg");
  });

  test("prepares a wav file for sidecar file playback", async () => {
    const calls: string[][] = [];
    const service = createYtdlpYoutubeService(env, {
      spawn: (options) => {
        calls.push([...options.cmd]);
        const outputIndex = options.cmd.indexOf("-o");
        const exited = outputIndex >= 0
          ? Bun.write(String(options.cmd[outputIndex + 1]).replace("%(ext)s", "webm"), new Uint8Array([1, 2, 3])).then(() => 0)
          : Bun.write(String(options.cmd.at(-1)), new Uint8Array([82, 73, 70, 70])).then(() => 0);
        return {
          stdout: emptyStream(),
          stderr: emptyStream(),
          exited,
          kill: () => undefined,
        };
      },
    });

    const prepared = await service.prepareAudioFile({
      mode: "url",
      query: "https://youtube.test/watch?v=1",
      url: "https://media.test/audio",
      webpageUrl: "https://youtube.test/watch?v=1",
      playbackFormat: "wav_pcm_s16le_48000_stereo",
    });

    expect(prepared.format).toBe("wav_pcm_s16le_48000_stereo");
    expect(prepared.path.endsWith("audio.wav")).toBe(true);
    expect(calls.at(-1)).toEqual(expect.arrayContaining([
      "ffmpeg",
      "-acodec",
      "pcm_s16le",
      "-f",
      "wav",
      expect.stringContaining("audio.wav"),
    ]));
  });
});
