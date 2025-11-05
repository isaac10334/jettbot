// src/audio/io.ts
// One-path audio I/O for Discord bots.
// Model output: PCM16/24k/mono → FFmpeg resample to 48k/stereo → Opus encode → Discord (StreamType.Opus)
// This module gives you:
//  - createPcm24MonoToOpus48Stereo(): bridge with {write,end,opus,ready,firstPacket,close}
//  - makeDiscordVoiceRuntime(): { playOpus(opusReadable) }
//  - awaitWithTimeout(): labeled timeout helper
// All gnarly stream/FFmpeg/encoder wiring lives here.
//
// Design notes:
// - We start Discord playback BEFORE we write PCM into the bridge to avoid losing initial frames.
// - We detect "first Opus packet is AVAILABLE" via 'readable' (non-consuming), not 'data'.
// - We try prism-media's FFmpeg wrapper first; if spawn is slow/broken, we fall back to raw ffmpeg spawn,
//   and we ALWAYS wire ffmpeg's stdin immediately in the raw path.

import '@discordjs/opus'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConst } from 'node:fs'
import { access } from 'node:fs/promises'
import { platform } from 'node:os'
import { PassThrough, Readable, Transform } from 'node:stream'
import {
  AudioPlayerStatus,
  createAudioResource,
  entersState,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice'

/* --------------------------- Tuning & Diagnostics --------------------------- */

export const DEBUG_AUDIO = !!(process.env.DEBUG && process.env.DEBUG !== '0')

export const TO = {
  ffmpegVersion: 5_000,
  ffmpegPrismSpawnFast: 1_500,
  bridgeReady: 5_000,
  discordConnReady: 10_000,
  playerStart: 10_000,
  opusWarmup: 800,
  rtConnect: 8_000,
  beep: 6_000,
}

export async function awaitWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | null = null
  return await Promise.race<T>([
    p.finally(() => {
      if (t) clearTimeout(t)
    }),
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`[timeout] ${label} exceeded ${ms}ms`)), ms)
    }),
  ])
}

/* ------------------------------ FFmpeg Helpers ------------------------------ */

export async function resolveFfmpegPath(): Promise<string | null> {
  const envPath = process.env.FFMPEG_PATH?.trim()
  if (envPath) {
    try {
      await access(envPath, fsConst.X_OK)
      return envPath
    } catch {
      return envPath
    }
  }
  const candidates =
    platform() === 'win32'
      ? ['ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']
      : ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  for (const c of candidates) {
    try {
      await access(c, fsConst.X_OK)
      return c
    } catch {}
  }
  return null
}

export async function sanityCheckFfmpeg(): Promise<string> {
  const bin = (await resolveFfmpegPath()) ?? 'ffmpeg'
  return awaitWithTimeout<string>(
    new Promise<string>((resolve, reject) => {
      const p = spawn(bin, ['-version'])
      let out = ''
      let err = ''
      p.stdout.on('data', d => (out += String(d)))
      p.stderr.on('data', d => (err += String(d)))
      p.once('error', reject)
      p.once('exit', code => {
        if (code === 0 && out) resolve(out.split('\n')[0]?.trim() || 'ffmpeg OK')
        else reject(new Error(`ffmpeg -version failed (code ${code}): ${err || out}`))
      })
    }),
    TO.ffmpegVersion,
    'ffmpeg -version'
  )
}

/* ------------------------------ Bridge Interface ---------------------------- */

export type Pcm24ToOpus = {
  // feed PCM16LE @ 24k mono (e.g., from Realtime WS)
  write: (buf: Buffer) => void
  end: () => void
  // encoded Opus @ 48k stereo (safe to hand to Discord with StreamType.Opus)
  opus: NodeJS.ReadableStream
  // resolves when FFmpeg + encoder are plumbed
  ready: Promise<void>
  // resolves on first Opus frame being AVAILABLE (non-consuming)
  firstPacket: Promise<void>
  // hard cleanup (ok to call multiple times)
  close: () => void
}

const FF_ARGS_COMMON = ['-nostdin', '-hide_banner', '-loglevel', 'error']

function ffArgs24monoTo48stereoPcm(): string[] {
  return [
    ...FF_ARGS_COMMON,
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
  ]
}

// raw ffmpeg spawn that ALWAYS wires stdin immediately
async function rawSpawnFfmpeg(
  ffArgs: string[],
  input: PassThrough
): Promise<NodeJS.ReadableStream> {
  const bin = (await resolveFfmpegPath()) ?? 'ffmpeg'
  if (DEBUG_AUDIO) console.warn('[ffmpeg] raw spawn ->', bin)
  const cp = spawn(bin, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

  try {
    input.pipe(cp.stdin!)
  } catch {}

  const out = new PassThrough({ highWaterMark: 1 << 16 })
  cp.stdout!.pipe(out)
  cp.stderr?.on('data', d => {
    if (DEBUG_AUDIO) process.stderr.write(String(d))
  })
  const fin = () => out.end()
  cp.once('close', fin).once('exit', fin)
  cp.once('error', err => {
    try {
      out.destroy(err as any)
    } catch {}
  })
  return out as unknown as NodeJS.ReadableStream
}

/**
 * The only bridge you need:
 * PCM16 mono @ 24k → FFmpeg upsample → PCM16 stereo @ 48k → Opus (48k/stereo)
 *
 * Usage pattern:
 *   const br = createPcm24MonoToOpus48Stereo()
 *   await br.ready
 *   const pb = voice.playOpus(br.opus) // start playback first!
 *   br.write(pcmChunk); br.end()
 */
export function createPcm24MonoToOpus48Stereo(): Pcm24ToOpus {
  const pcm24In = new PassThrough({ highWaterMark: 1 << 16 })
  pcm24In.setMaxListeners(0)

  let ended = false
  let closed = false
  let _opus: NodeJS.ReadableStream | null = null

  let resolveReady!: () => void
  let rejectReady!: (e: unknown) => void
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })

  let resolveFirst!: () => void
  const firstPacket = new Promise<void>(res => (resolveFirst = res))

  const ffArgs = ffArgs24monoTo48stereoPcm()

  void (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismAny = (await import('prism-media')) as any
    const Prism = prismAny?.default ?? prismAny
    const OpusEncoder = Prism?.opus?.Encoder
    const FFmpegCtor = Prism?.FFmpeg
    if (!OpusEncoder) throw new Error('prism-media: opus Encoder missing')

    const wireEnc = (src: NodeJS.ReadableStream) => {
      const enc = new OpusEncoder({ rate: 48_000, channels: 2, frameSize: 960 })
      enc.on('error', (e: unknown) => console.warn('[opus:enc:error]', (e as Error)?.message ?? e))
      _opus = src.pipe(enc)
      // non-consuming readiness
      _opus!.once('readable', () => {
        try {
          resolveFirst()
        } catch {}
      })
      ;(cleanup as any).ff = src
      ;(cleanup as any).enc = enc
    }

    if (FFmpegCtor) {
      try {
        const prismFF = new FFmpegCtor({ args: ffArgs })
        let spawned = false
        const fall = setTimeout(async () => {
          if (!spawned) {
            try {
              ;(prismFF as any)?.destroy?.()
            } catch {}
            const rawOut = await rawSpawnFfmpeg(ffArgs, pcm24In)
            resolveReady()
            wireEnc(rawOut)
          }
        }, TO.ffmpegPrismSpawnFast)

        prismFF.once('spawn', (cp: ChildProcess) => {
          spawned = true
          clearTimeout(fall)
          if (cp?.stdin) pcm24In.pipe(cp.stdin)
          resolveReady()
        })
        prismFF.once('error', async (e: unknown) => {
          if (closed) return
          console.warn('[ffmpeg:prism:error]', (e as Error)?.message ?? e)
          try {
            ;(prismFF as any)?.destroy?.()
          } catch {}
          const rawOut = await rawSpawnFfmpeg(ffArgs, pcm24In)
          resolveReady()
          wireEnc(rawOut)
        })

        wireEnc(prismFF as unknown as NodeJS.ReadableStream)
        return
      } catch (e) {
        if (DEBUG_AUDIO) console.warn('[ffmpeg] prism ctor failed; raw spawn fallback:', e)
      }
    }

    const rawOut = await rawSpawnFfmpeg(ffArgs, pcm24In)
    resolveReady()
    wireEnc(rawOut)
  })().catch(err => {
    try {
      rejectReady(err)
    } catch {}
  })

  function write(buf: Buffer) {
    if (ended || closed) return
    if (buf.length & 1) buf = buf.subarray(0, buf.length - 1) // keep s16 alignment
    const ok = pcm24In.write(buf)
    if (!ok) pcm24In.once('drain', () => {})
  }
  function end() {
    if (!ended && !closed) {
      ended = true
      try {
        pcm24In.end()
      } catch {}
    }
  }
  function cleanup() {
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
  function close() {
    if (!closed) {
      closed = true
      cleanup()
    }
  }

  return {
    write,
    end,
    get opus() {
      if (!_opus) throw new Error('bridge not ready yet')
      return _opus as NodeJS.ReadableStream
    },
    ready,
    firstPacket,
    close,
  }
}

/* --------------------------- Discord Voice Runtime ------------------------- */

export type Playback = { done: Promise<void> }
export type VoiceRuntime = {
  playOpus: (opus: NodeJS.ReadableStream) => Playback
}

export function makeDiscordVoiceRuntime(conn: VoiceConnection, player: AudioPlayer): VoiceRuntime {
  // Connect/subscribe with a safety timeout
  try {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    awaitWithTimeout(
      entersState(conn, VoiceConnectionStatus.Ready, TO.discordConnReady),
      TO.discordConnReady + 1000,
      'discord connection ready'
    )
    conn.subscribe(player)
  } catch (e) {
    console.warn('[voice:init]', e)
  }

  function playOpus(opus: NodeJS.ReadableStream): Playback {
    // We pass already-encoded Opus, so tell Discord it's Opus.
    const res = createAudioResource(opus as Readable, { inputType: StreamType.Opus })
    player.play(res)
    const done = (async () => {
      try {
        await awaitWithTimeout(
          entersState(player, AudioPlayerStatus.Playing, TO.playerStart),
          TO.playerStart + 500,
          'player playing (opus)'
        )
        // Resolve when the player goes idle after draining.
        await new Promise<void>(res => {
          // 'idle' fires when playback finishes
          player.once('idle', () => res())
        })
      } catch {}
    })()
    return { done }
  }

  return { playOpus }
}

// ---------- Inbound helper: Discord (Opus 48k/stereo) -> PCM16 24k/mono ----------

/**
 * Convert Discord receiver's Opus stream (48k/stereo) into PCM16 mono @ 24k.
 * You pass the Readable returned by `conn.receiver.subscribe(userId, ...)`.
 */
export async function opus48StereoToPcm24Mono(
  opus: NodeJS.ReadableStream
): Promise<NodeJS.ReadableStream> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismAny: any = await import('prism-media')
  const Prism = prismAny?.default ?? prismAny
  const OpusDecoder = Prism?.opus?.Decoder
  if (!OpusDecoder) throw new Error('prism-media opus Decoder missing')

  // 1) Decode Opus → PCM16/48k/stereo
  const dec = new OpusDecoder({ rate: 48_000, channels: 2, frameSize: 960 })
  const pcm48st = (opus as any).pipe(dec)

  // 2) Resample + downmix → PCM16/24k/mono via raw ffmpeg
  const ffArgs = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'warning',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    'pipe:0',
    '-fflags',
    '+bitexact',
    '-f',
    's16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    'pipe:1',
  ]

  const bin = (await resolveFfmpegPath()) ?? 'ffmpeg'
  if (DEBUG_AUDIO) console.warn('[ffmpeg] rx raw spawn ->', bin)
  const { spawn } = await import('node:child_process')
  const cp = spawn(bin, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

  pcm48st.pipe(cp.stdin!)
  cp.stderr?.on('data', d => {
    if (DEBUG_AUDIO) process.stderr.write(String(d))
  })

  return cp.stdout as unknown as NodeJS.ReadableStream
}

// /** 10ms of PCM16 mono @ 24k silence, useful to "commit" a turn on end */
// export function pcm24Silence10ms(): Buffer {
//   // 24000 samples/sec * 0.01 sec * 2 bytes = 480 bytes
//   return Buffer.allocUnsafe(480).fill(0)
// }
