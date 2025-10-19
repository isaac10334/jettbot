// __internal/rtAudio.ts
import '@discordjs/opus'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'

export type Pcm24ToOpus = {
  write: (buf: Buffer) => void // 24k mono PCM16LE
  end: () => void // graceful end
  opus: NodeJS.ReadableStream // Opus @ 48k stereo
  close: () => void // hard close
  ready: Promise<void> // resolves when FFmpeg spawned
}

export function createPcm24MonoToOpus48Stereo(): Pcm24ToOpus {
  const pcm24In = new PassThrough({ highWaterMark: 1 << 16 })
  pcm24In.setMaxListeners(0)

  let ended = false
  let closed = false

  let spawnResolve!: () => void
  let spawnReject!: (e: unknown) => void
  const ready = new Promise<void>((res, rej) => {
    spawnResolve = res
    spawnReject = rej
  })
  const spawnTimer = setTimeout(() => {
    console.warn('[ffmpeg] spawn timeout (5s). Is FFMPEG_PATH set before use?')
    try {
      spawnReject(new Error('ffmpeg spawn timeout'))
    } catch {}
  }, 5000)

  // Lazy import prism-media so process.env.FFMPEG_PATH is already set.
  let opus!: NodeJS.ReadableStream
  ;(async () => {
    const mod = (await import('prism-media')) as any
    // Handle all shapes: CJS (module.exports = …) and ESM interop
    const Prism = mod && mod.default ? mod.default : mod

    const FFmpegCtor = Prism?.FFmpeg
    const OpusEncoder = Prism?.opus?.Encoder

    if (!FFmpegCtor || !OpusEncoder) {
      throw new Error('prism-media missing FFmpeg or opus Encoder exports')
    }

    const ff = new FFmpegCtor({
      // If FFMPEG_PATH is set, prism-media will use it automatically.
      args: [
        '-f',
        's16le',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-fflags',
        '+bitexact',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1',
      ],
    })

    ff.once('spawn', (cp: ChildProcess) => {
      clearTimeout(spawnTimer)
      if (cp?.stdin) pcm24In.pipe(cp.stdin)
      spawnResolve()
    })

    ff.on('error', (e: unknown) => {
      console.warn('[ffmpeg:error]', (e as Error)?.message ?? e)
      try {
        spawnReject(e)
      } catch {}
    })

    const enc = new OpusEncoder({ rate: 48_000, channels: 2, frameSize: 960 })
    enc.on('error', (e: unknown) => console.warn('[opus:enc:error]', (e as Error)?.message ?? e))

    opus = ff.pipe(enc)

    // expose for cleanup()
    ;(cleanup as any).ff = ff
    ;(cleanup as any).enc = enc
  })().catch(err => {
    try {
      spawnReject(err)
    } catch {}
  })

  function write(buf: Buffer): void {
    if (ended || closed) return
    if (buf.length & 1) buf = buf.subarray(0, buf.length - 1) // keep s16 alignment
    const ok = pcm24In.write(buf)
    if (!ok) pcm24In.once('drain', () => {})
  }

  function end(): void {
    if (ended || closed) return
    ended = true
    try {
      pcm24In.end()
    } catch {}
  }

  function cleanup(): void {
    try {
      pcm24In.destroy()
    } catch {}
    try {
      ;(cleanup as any).ff?.destroy?.()
    } catch {}
    try {
      ;(cleanup as any).enc?.destroy?.()
    } catch {}
  }

  function close(): void {
    if (closed) return
    closed = true
    cleanup()
  }

  return {
    write,
    end,
    get opus() {
      return opus
    },
    close,
    ready,
  }
}
