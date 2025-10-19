// __internal/ffmpegBoot.ts
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export function forceFFmpegPath(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static not found')
  process.env.FFMPEG_PATH = ffmpegPath // prism-media respects this
  return ffmpegPath
}

export function probeFFmpeg(cmd = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<boolean> {
  return new Promise<boolean>(res => {
    const p = spawn(cmd, ['-hide_banner', '-loglevel', 'error', '-version'], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    p.once('error', () => res(false))
    p.once('exit', code => res(code === 0))
  })
}

export async function ensureFFmpeg(): Promise<string> {
  const path = forceFFmpegPath()
  const ok = await probeFFmpeg(path)
  if (!ok) throw new Error(`FFmpeg not available at ${path}`)
  return path
}
