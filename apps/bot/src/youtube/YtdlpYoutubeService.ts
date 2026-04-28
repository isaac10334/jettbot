import type { Env } from "../Env";
import type { YoutubeMedia, YoutubeService } from "./YoutubeService";

export const createYtdlpYoutubeService = (env: Env): YoutubeService => {
  let active: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  return {
    resolve: async (queryOrUrl): Promise<YoutubeMedia> => {
      const proc = Bun.spawn({
        cmd: [env.YTDLP_PATH, "--dump-json", "--no-playlist", queryOrUrl],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error(`yt-dlp failed: ${stderr}`);
      const data = JSON.parse(stdout) as { title?: string; webpage_url?: string; duration?: number; url?: string };
      return {
        ...(data.title ? { title: data.title } : {}),
        url: data.url ?? data.webpage_url ?? queryOrUrl,
        ...(data.webpage_url ? { webpageUrl: data.webpage_url } : {}),
        ...(data.duration != null ? { durationSeconds: data.duration } : {}),
      };
    },
    getAudioStream: async (input) => {
      active = Bun.spawn({
        cmd: [env.YTDLP_PATH, "-f", "bestaudio", "-o", "-", input.webpageUrl ?? input.url],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      return active.stdout;
    },
    stop: async () => {
      active?.kill("SIGTERM");
      await active?.exited.catch(() => 1);
      active = undefined;
    },
  };
};
