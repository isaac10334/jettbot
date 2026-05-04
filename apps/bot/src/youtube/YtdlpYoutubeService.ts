import type { Console } from "@loop-kit/common/Console";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../Env";
import type { MetricsService } from "../observability/MetricsService";
import type { RealtimeDebugCaptureService } from "../observability/RealtimeDebugCaptureService";
import type { YoutubeMedia, YoutubeService } from "./YoutubeService";

const playbackFormat = "wav_pcm_s16le_48000_stereo" as const;
const maxStderrSnippetLength = 2_000;

export interface YoutubeResolveTarget {
  readonly mode: "url" | "search";
  readonly query: string;
  readonly target: string;
}

interface SpawnOptions {
  readonly cmd: readonly string[];
  readonly stdin?: "ignore" | "pipe" | ReadableStream<Uint8Array>;
  readonly stdout?: "pipe" | "ignore";
  readonly stderr?: "pipe" | "ignore";
}

interface YoutubeSubprocess {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin?: WritableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly kill: (signal?: string) => void;
}

type YoutubeSpawn = (options: SpawnOptions) => YoutubeSubprocess;

interface ActiveStream {
  readonly ytdlp?: YoutubeSubprocess;
  readonly ffmpeg?: YoutubeSubprocess;
  readonly tempDir?: string;
  readonly ytdlpStderr?: Promise<string>;
  readonly ffmpegStderr?: Promise<string>;
}

export interface YoutubeServiceObservability {
  readonly console?: Console;
  readonly metrics?: MetricsService;
  readonly realtimeDebug?: RealtimeDebugCaptureService;
}

export interface YtdlpYoutubeServiceOptions extends YoutubeServiceObservability {
  readonly spawn?: YoutubeSpawn;
}

export const createYoutubeResolveTarget = (queryOrUrl: string): YoutubeResolveTarget => {
  const query = queryOrUrl.trim();
  if (query.length === 0) throw new Error("YouTube query cannot be empty.");

  try {
    const url = new URL(query);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { mode: "url", query, target: query };
    }
  } catch {
    // Plain text search query.
  }

  return { mode: "search", query, target: `ytsearch1:${query}` };
};

const createYtdlpArgs = (env: Env, args: readonly string[]): string[] => [
  env.YTDLP_PATH,
  ...(env.YOUTUBE_COOKIES_PATH ? ["--cookies", env.YOUTUBE_COOKIES_PATH] : []),
  ...args,
];

const readText = async (stream: ReadableStream<Uint8Array>): Promise<string> => await new Response(stream).text();

const snippet = (value: string): string => value.trim().slice(0, maxStderrSnippetLength);

const writeDebug = (debug: RealtimeDebugCaptureService | undefined, value: unknown): void => {
  debug?.writeJsonLine("text/youtube.jsonl", value);
};

const cleanupTempDir = async (path: string | undefined): Promise<void> => {
  if (!path) return;
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
};

const instrumentFirstByte = (
  stream: ReadableStream<Uint8Array>,
  onFirstByte: (elapsedMs: number) => void,
  startMs: number,
): ReadableStream<Uint8Array> => {
  let seenFirstByte = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!seenFirstByte) {
            seenFirstByte = true;
            onFirstByte(performance.now() - startMs);
          }
          controller.enqueue(next.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
};

export const __youtubeTestUtils = {
  createYtdlpArgs,
  createYoutubeResolveTarget,
};

export const createYtdlpYoutubeService = (env: Env, options: YtdlpYoutubeServiceOptions = {}): YoutubeService => {
  const spawn: YoutubeSpawn = options.spawn ?? ((input) => Bun.spawn(input as unknown as Parameters<typeof Bun.spawn>[0]) as YoutubeSubprocess);
  const console = options.console?.child("youtube");
  const metrics = options.metrics;
  const realtimeDebug = options.realtimeDebug;
  let active: ActiveStream | undefined;

  const clearActive = (stream: ActiveStream): void => {
    if (active === stream) active = undefined;
  };

  const stopActive = async (): Promise<void> => {
    const stream = active;
    if (!stream) return;
    stream.ytdlp?.kill("SIGTERM");
    stream.ffmpeg?.kill("SIGTERM");
    await Promise.allSettled([
      stream.ytdlp?.exited ?? Promise.resolve(0),
      stream.ffmpeg?.exited ?? Promise.resolve(0),
      stream.ytdlpStderr ?? Promise.resolve(""),
      stream.ffmpegStderr ?? Promise.resolve(""),
    ]);
    await cleanupTempDir(stream.tempDir);
    clearActive(stream);
  };

  return {
    resolve: async (queryOrUrl): Promise<YoutubeMedia> => {
      const target = createYoutubeResolveTarget(queryOrUrl);
      const start = performance.now();
      metrics?.increment("youtube.resolve.started");
      console?.info("resolve.start", { mode: target.mode, query: target.query, target: target.target });
      writeDebug(realtimeDebug, { type: "youtube.resolve.start", mode: target.mode, query: target.query, target: target.target });

      const proc = spawn({
        cmd: createYtdlpArgs(env, ["--dump-json", "--no-playlist", target.target]),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([readText(proc.stdout), readText(proc.stderr), proc.exited]);
      const elapsedMs = performance.now() - start;
      metrics?.recordTiming("youtube.resolve.duration_ms", elapsedMs);
      if (code !== 0) {
        metrics?.increment("youtube.resolve.failed");
        const message = snippet(stderr) || `yt-dlp exited with code ${code}`;
        console?.error("resolve.failed", { mode: target.mode, query: target.query, code, stderr: message });
        writeDebug(realtimeDebug, { type: "youtube.resolve.failed", mode: target.mode, query: target.query, code, stderr: message });
        throw new Error(`yt-dlp failed: ${message}`);
      }

      let data: { title?: string; webpage_url?: string; duration?: number; url?: string };
      try {
        data = JSON.parse(stdout) as typeof data;
      } catch (error) {
        metrics?.increment("youtube.resolve.failed");
        console?.error("resolve.invalid_json", { mode: target.mode, query: target.query, error });
        writeDebug(realtimeDebug, { type: "youtube.resolve.failed", mode: target.mode, query: target.query, error: "invalid_json" });
        throw new Error("yt-dlp returned invalid metadata JSON.");
      }

      const media: YoutubeMedia = {
        ...(data.title ? { title: data.title } : {}),
        mode: target.mode,
        query: target.query,
        url: data.url ?? data.webpage_url ?? target.target,
        ...(data.webpage_url ? { webpageUrl: data.webpage_url } : {}),
        ...(data.duration != null ? { durationSeconds: data.duration } : {}),
        playbackFormat,
      };
      metrics?.increment("youtube.resolve.completed");
      console?.info("resolve.success", {
        mode: media.mode,
        query: media.query,
        title: media.title,
        webpageUrl: media.webpageUrl,
        durationSeconds: media.durationSeconds,
        elapsedMs,
      });
      writeDebug(realtimeDebug, {
        type: "youtube.resolve.success",
        mode: media.mode,
        query: media.query,
        title: media.title,
        webpageUrl: media.webpageUrl,
        durationSeconds: media.durationSeconds,
        elapsedMs,
      });
      return media;
    },

    getAudioStream: async (input) => {
      await stopActive();
      const start = performance.now();
      const source = input.webpageUrl ?? input.url;
      metrics?.increment("youtube.stream.started");
      console?.info("stream.start", { title: input.title, webpageUrl: input.webpageUrl, source });
      writeDebug(realtimeDebug, { type: "youtube.stream.start", title: input.title, webpageUrl: input.webpageUrl, source });

      const tempDir = await mkdtemp(join(tmpdir(), "jettbot-youtube-"));
      const outputTemplate = join(tempDir, "audio.%(ext)s");

      const ytdlp = spawn({
        cmd: createYtdlpArgs(env, ["-f", "bestaudio", "--no-playlist", "-o", outputTemplate, source]),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const ytdlpStderr = readText(ytdlp.stderr);
      const downloading: ActiveStream = { ytdlp, tempDir, ytdlpStderr };
      active = downloading;

      const [downloadCode, downloadErr] = await Promise.all([ytdlp.exited, ytdlpStderr]);
      if (downloadCode !== 0) {
        metrics?.increment("youtube.stream.failed");
        const message = snippet(downloadErr) || `yt-dlp exited with code ${downloadCode}`;
        console?.error("stream.download_failed", { code: downloadCode, stderr: message });
        writeDebug(realtimeDebug, { type: "youtube.stream.download_failed", code: downloadCode, stderr: message });
        await cleanupTempDir(tempDir);
        clearActive(downloading);
        throw new Error(`yt-dlp audio download failed: ${message}`);
      }

      const files = await readdir(tempDir);
      const audioFile = files.length === 1 ? join(tempDir, files[0] as string) : undefined;
      if (!audioFile) {
        metrics?.increment("youtube.stream.failed");
        await cleanupTempDir(tempDir);
        clearActive(downloading);
        throw new Error("yt-dlp did not produce an audio file.");
      }

      const downloadMs = performance.now() - start;
      metrics?.recordTiming("youtube.stream.download_ms", downloadMs);
      console?.info("stream.downloaded", { audioFile, downloadMs });
      writeDebug(realtimeDebug, { type: "youtube.stream.downloaded", audioFile, downloadMs });

      const ffmpeg = spawn({
        cmd: [env.FFMPEG_PATH, "-loglevel", "warning", "-i", audioFile, "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1"],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const ffmpegStderr = readText(ffmpeg.stderr);
      const stream: ActiveStream = { ffmpeg, tempDir, ffmpegStderr };
      active = stream;

      void Promise.allSettled([ffmpeg.exited, ffmpegStderr]).then(async () => {
        const [ffmpegCode, ffmpegErr] = await Promise.all([
          ffmpeg.exited.catch(() => -1),
          ffmpegStderr.catch((error) => String(error)),
        ]);
        const elapsedMs = performance.now() - start;
        const ok = ffmpegCode === 0;
        metrics?.increment(ok ? "youtube.stream.completed" : "youtube.stream.failed");
        metrics?.recordTiming("youtube.stream.duration_ms", elapsedMs);
        const log = {
          ffmpegCode,
          elapsedMs,
          ffmpegStderr: snippet(ffmpegErr),
        };
        if (ok) console?.info("stream.exit", log);
        else console?.error("stream.exit", log);
        writeDebug(realtimeDebug, {
          type: "youtube.stream.exit",
          ffmpegCode,
          elapsedMs,
          ffmpegStderr: snippet(ffmpegErr),
        });
        await cleanupTempDir(tempDir);
        clearActive(stream);
      });

      return instrumentFirstByte(ffmpeg.stdout, (firstByteMs) => {
        metrics?.recordTiming("youtube.stream.first_byte_ms", firstByteMs);
        console?.info("stream.first_byte", { firstByteMs });
        writeDebug(realtimeDebug, { type: "youtube.stream.first_byte", firstByteMs });
      }, start);
    },

    prepareAudioFile: async (input) => {
      await stopActive();
      const start = performance.now();
      const source = input.webpageUrl ?? input.url;
      const tempDir = await mkdtemp(join(tmpdir(), "jettbot-youtube-"));
      const downloadedTemplate = join(tempDir, "audio.%(ext)s");
      const pcmPath = join(tempDir, "audio.wav");
      metrics?.increment("youtube.file.started");
      console?.info("file.start", { title: input.title, webpageUrl: input.webpageUrl, source });
      writeDebug(realtimeDebug, { type: "youtube.file.start", title: input.title, webpageUrl: input.webpageUrl, source });

      const downloadCmd = createYtdlpArgs(env, ["-f", "bestaudio", "--no-playlist", "-o", downloadedTemplate, source]);
      writeDebug(realtimeDebug, { type: "youtube.file.ytdlp.start", cmd: downloadCmd });
      const ytdlp = spawn({
        cmd: downloadCmd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const ytdlpStderr = readText(ytdlp.stderr);
      const downloading: ActiveStream = { ytdlp, tempDir, ytdlpStderr };
      active = downloading;
      const [downloadCode, downloadErr] = await Promise.all([ytdlp.exited, ytdlpStderr]);
      writeDebug(realtimeDebug, {
        type: "youtube.file.ytdlp.exit",
        code: downloadCode,
        stderr: snippet(downloadErr),
      });
      if (downloadCode !== 0) {
        metrics?.increment("youtube.file.failed");
        const message = snippet(downloadErr) || `yt-dlp exited with code ${downloadCode}`;
        await cleanupTempDir(tempDir);
        clearActive(downloading);
        throw new Error(`yt-dlp audio download failed: ${message}`);
      }

      const files = (await readdir(tempDir)).filter((file) => file !== "audio.wav");
      const audioFile = files.length === 1 ? join(tempDir, files[0] as string) : undefined;
      if (!audioFile) {
        metrics?.increment("youtube.file.failed");
        await cleanupTempDir(tempDir);
        clearActive(downloading);
        throw new Error("yt-dlp did not produce an audio file.");
      }
      const downloadedStats = await stat(audioFile);
      writeDebug(realtimeDebug, {
        type: "youtube.file.download.ready",
        path: audioFile,
        byteLength: downloadedStats.size,
      });

      const ffmpegCmd = [
          env.FFMPEG_PATH,
          "-loglevel",
          "warning",
          "-i",
          audioFile,
          "-vn",
          "-acodec",
          "pcm_s16le",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-f",
          "wav",
          pcmPath,
      ];
      writeDebug(realtimeDebug, { type: "youtube.file.ffmpeg.start", cmd: ffmpegCmd });
      const ffmpeg = spawn({
        cmd: ffmpegCmd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const ffmpegStderr = readText(ffmpeg.stderr);
      const preparing: ActiveStream = { ffmpeg, tempDir, ffmpegStderr };
      active = preparing;
      const [ffmpegCode, ffmpegErr] = await Promise.all([ffmpeg.exited, ffmpegStderr]);
      writeDebug(realtimeDebug, {
        type: "youtube.file.ffmpeg.exit",
        code: ffmpegCode,
        stderr: snippet(ffmpegErr),
      });
      if (ffmpegCode !== 0) {
        metrics?.increment("youtube.file.failed");
        const message = snippet(ffmpegErr) || `ffmpeg exited with code ${ffmpegCode}`;
        await cleanupTempDir(tempDir);
        clearActive(preparing);
        throw new Error(`ffmpeg audio conversion failed: ${message}`);
      }

      const elapsedMs = performance.now() - start;
      const preparedStats = await stat(pcmPath);
      metrics?.increment("youtube.file.completed");
      metrics?.recordTiming("youtube.file.duration_ms", elapsedMs);
      console?.info("file.ready", { path: pcmPath, byteLength: preparedStats.size, elapsedMs });
      writeDebug(realtimeDebug, { type: "youtube.file.ready", path: pcmPath, format: playbackFormat, byteLength: preparedStats.size, elapsedMs });
      active = { tempDir };
      const cleanupDelayMs = Math.max(60_000, ((input.durationSeconds ?? 0) + 60) * 1_000);
      setTimeout(() => {
        if (active?.tempDir === tempDir) {
          void cleanupTempDir(tempDir).then(() => {
            if (active?.tempDir === tempDir) active = undefined;
          });
        }
      }, cleanupDelayMs).unref?.();
      return { path: pcmPath, format: playbackFormat };
    },

    stop: async () => {
      const stream = active;
      if (!stream) return;
      metrics?.increment("youtube.stream.stop.started");
      console?.info("stream.stop");
      writeDebug(realtimeDebug, { type: "youtube.stream.stop" });
      await stopActive();
      metrics?.increment("youtube.stream.stop.completed");
    },
  };
};
