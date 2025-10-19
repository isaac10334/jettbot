// jettbot.ts
// One-path audio: Realtime PCM16/24k/mono → FFmpeg 48k/stereo → Opus → Discord (StreamType.Opus)

/* -------------------------------- Boot & Deps ------------------------------- */

import 'dotenv/config'
import '@discordjs/opus'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { constants as fsConst } from 'node:fs'
import { access } from 'node:fs/promises'
import { platform } from 'node:os'
import { PassThrough, Readable, Transform } from 'node:stream'
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice'
import { RealtimeAgent, RealtimeSession, type TransportLayerAudio } from '@openai/agents/realtime'
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type GuildMember,
  type Message,
} from 'discord.js'

/* --------------------------- Configuration & Flags -------------------------- */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const GUILD_ID = process.env.GUILD_ID ?? ''
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID ?? ''
const DEFAULT_MODEL = process.env.MODEL ?? 'gpt-realtime'
const DEBUG_AUDIO = !!(process.env.DEBUG && process.env.DEBUG !== '0')

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env')
  process.exit(1)
}

/* ------------------------------- Timeouts ----------------------------------- */

const TO = {
  ffmpegVersion: 5_000,
  ffmpegPrismSpawnFast: 1_500,
  bridgeReady: 5_000,
  discordConnReady: 10_000,
  playerStart: 10_000,
  rtConnect: 8_000,
  beep: 6_000,
  opusWarmup: 800,
}

async function awaitWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

async function resolveFfmpegPath(): Promise<string | null> {
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

async function sanityCheckFfmpeg(): Promise<string> {
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

/* ------------------------------ Audio Bridge -------------------------------- */

type Pcm24ToOpus = {
  write: (buf: Buffer) => void // feed PCM16LE @ 24k mono
  end: () => void
  opus: NodeJS.ReadableStream // Opus @ 48k stereo
  ready: Promise<void> // bridge is plumbed
  firstPacket: Promise<void> // resolves when first Opus frame is AVAILABLE (readable)
  close: () => void
}

const FF_ARGS_COMMON = ['-nostdin', '-hide_banner', '-loglevel', 'warning']
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

function createPcm24MonoToOpus48Stereo(): Pcm24ToOpus {
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
      // Non-consuming readiness
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
    get opus(): NodeJS.ReadableStream {
      if (!_opus) throw new Error('bridge not ready yet')
      return _opus as NodeJS.ReadableStream
    },
    ready,
    firstPacket,
    close,
  }
}

/* --------------------------- Discord Voice Runtime ------------------------- */

type Playback = { done: Promise<void> }
type VoiceRuntime = {
  playOpus: (opus: NodeJS.ReadableStream) => Playback
}

class PcmVolume extends Transform {
  private vol = 1
  constructor(v = 1) {
    super()
    this.vol = Math.max(0, v)
  }
  setVolume(v: number) {
    this.vol = Math.max(0, v)
  }
  override _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (e?: Error | null, d?: Buffer) => void
  ) {
    if (this.vol === 1) return cb(null, chunk)
    const out = Buffer.from(chunk)
    for (let i = 0; i < out.length; i += 2) {
      const s = out.readInt16LE(i)
      let v = (s * this.vol) | 0
      if (v > 0x7fff) v = 0x7fff
      else if (v < -0x8000) v = -0x8000
      out.writeInt16LE(v, i)
    }
    cb(null, out)
  }
}

function makeDiscordVoiceRuntime(conn: VoiceConnection, player: AudioPlayer): VoiceRuntime {
  try {
    conn.on('stateChange', (o, n) => {
      if (DEBUG_AUDIO) console.log('[conn]', o.status, '->', n.status)
    })
    player.on('stateChange', (o, n) => {
      if (DEBUG_AUDIO) console.log('[player]', o.status, '->', n.status)
    })
    player.on('error', e => console.warn('[player:error]', e.message))
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
    const res = createAudioResource(opus as Readable, { inputType: StreamType.Opus })
    player.play(res)
    const done = (async () => {
      try {
        await awaitWithTimeout(
          entersState(player, AudioPlayerStatus.Playing, TO.playerStart),
          TO.playerStart + 500,
          'player playing (opus)'
        )
        await once(player, 'idle')
      } catch {}
    })()
    return { done }
  }

  return { playOpus }
}

/* -------------------------------- Beep Utils -------------------------------- */

function makeBeepPCM24kMono(durationSec = 0.6, freq = 660, vol = 0.05): Buffer {
  const SR = 24_000,
    N = Math.max(1, Math.floor(SR * durationSec))
  const out = Buffer.allocUnsafe(N * 2)
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const v = Math.sin(2 * Math.PI * freq * t) * vol
    out.writeInt16LE((Math.max(-1, Math.min(1, v)) * 0x7fff) | 0, i * 2)
  }
  return out
}

/* ------------------------------ Small Utilities ----------------------------- */

function settleWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    let done = false
    const t = setTimeout(() => {
      if (!done) {
        done = true
        resolve(false)
      }
    }, ms)
    p.then(
      () => {
        if (!done) {
          done = true
          clearTimeout(t)
          resolve(true)
        }
      },
      () => {
        if (!done) {
          done = true
          clearTimeout(t)
          resolve(false)
        }
      }
    )
  })
}
function safeClose(b: { end: () => void; close: () => void } | null | undefined) {
  if (!b) return
  try {
    b.end()
  } catch {}
  try {
    b.close()
  } catch {}
}

/* ------------------------ Sanity (FFmpeg + Bridge check) -------------------- */

async function sanityCheckAudio(): Promise<void> {
  const ver = await sanityCheckFfmpeg().catch(e => {
    throw new Error(`FFmpeg not runnable. Install it OR set FFMPEG_PATH. Cause: ${String(e)}`)
  })
  if (DEBUG_AUDIO) console.log('[ffmpeg]', ver)

  const opus = createPcm24MonoToOpus48Stereo()
  await awaitWithTimeout(opus.ready, TO.bridgeReady, 'bridge.ready (opus)')
  safeClose(opus)
}

/* ------------------------- Beep (Opus-only validator) ----------------------- */

async function beepTest(voice: VoiceRuntime, timeoutMs = TO.beep): Promise<boolean> {
  const pcm24 = makeBeepPCM24kMono(0.6, 660, 0.05)

  const br = createPcm24MonoToOpus48Stereo()
  await awaitWithTimeout(br.ready, TO.bridgeReady, 'beep: bridge.ready')

  // Start playback first
  const pb = voice.playOpus(br.opus)

  // Feed the bridge
  const r = Readable.from([pcm24.subarray(0, pcm24.length >> 1), pcm24.subarray(pcm24.length >> 1)])
  r.on('data', (chunk: Buffer) => br.write(chunk))
  r.on('end', () => br.end())

  const ok = await settleWithin(pb.done, timeoutMs)
  safeClose(br)
  return ok
}

/* --------------------- OpenAI Realtime → Discord playback ------------------- */

async function playAgentMessage(
  voice: VoiceRuntime,
  opts: {
    apiKey: string
    model?: string
    text?: string
    instructions?: string
    debug?: boolean
  }
): Promise<void> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    text = 'Say one short sentence, out loud.',
    instructions = 'Always respond with speech audio; keep answers under 5 seconds.',
    debug = false,
  } = opts

  const session = new RealtimeSession(new RealtimeAgent({ name: 'Jettbot', instructions }), {
    transport: 'websocket',
    model,
    config: { audio: { output: { format: 'pcm16', voice: 'alloy' } } }, // PCM16 mono @ 24k
  })
  await awaitWithTimeout(session.connect({ apiKey, model }), TO.rtConnect, 'realtime connect')
  if (debug) console.log('[rt] connected')

  let started = false
  let bridge: ReturnType<typeof createPcm24MonoToOpus48Stereo> | null = null

  const endAll = () => {
    try {
      bridge && safeClose(bridge)
    } catch {}
    try {
      session.close()
    } catch {}
  }

  session.on('audio_start', () => debug && console.log('[rt] audio_start'))

  session.on('audio', async (ev: TransportLayerAudio) => {
    const buf = Buffer.from(new Uint8Array(ev.data)) // PCM16 mono 24k

    if (!started) {
      started = true
      bridge = createPcm24MonoToOpus48Stereo()
      await awaitWithTimeout(bridge.ready, TO.bridgeReady, 'realtime: bridge.ready (opus)')

      // Start playback BEFORE any feeding
      const pb = voice.playOpus(bridge.opus)
      pb.done.catch(() => {}).then(endAll)

      // Optional: warn if no Opus quickly (but no PCM fallback anymore)
      awaitWithTimeout(bridge.firstPacket, TO.opusWarmup, 'realtime: opus first packet').catch(
        () => debug && console.warn('[rt] no opus seen yet — check ffmpeg/encoder')
      )
    }

    bridge!.write(buf)
  })

  session.on('audio_stopped', () => debug && console.log('[rt] audio_stopped'))
  session.on('audio_interrupted', () => debug && console.log('[rt] audio_interrupted'))
  session.on('agent_end', () => debug && console.log('[rt] agent_end'))
  session.on('error', e => {
    console.warn('[rt:error]', (e as any)?.error ?? e)
  })

  session.sendMessage(text)
}

/* --------------------------------- Bot Setup -------------------------------- */

type VoiceCtx = { conn: VoiceConnection; player: AudioPlayer; runtime: VoiceRuntime }
const voices = new Map<string, VoiceCtx>()

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
})

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user?.tag}`)
  try {
    await sanityCheckAudio()
    console.log('FFmpeg bridge: OK')
  } catch (e) {
    console.error(String(e))
  }

  if (GUILD_ID && VOICE_CHANNEL_ID) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID)
      const channel = await guild.channels.fetch(VOICE_CHANNEL_ID)
      if (channel?.isVoiceBased()) {
        const conn = joinVoiceChannel({
          channelId: channel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        })
        await awaitWithTimeout(
          entersState(conn, VoiceConnectionStatus.Ready, TO.discordConnReady),
          TO.discordConnReady + 1000,
          'startup: discord connection ready'
        )
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
        const runtime = makeDiscordVoiceRuntime(conn, player)
        conn.subscribe(player)
        voices.set(guild.id, { conn, player, runtime })

        if ('stageInstance' in channel && (channel as any).type?.toString().includes('Stage')) {
          try {
            await (channel as any).guild.members.me?.voice?.setSuppressed(false)
          } catch {}
        }

        console.log(`[startup] Joined voice channel: ${channel.name}`)
        const ok = await beepTest(runtime)
        console.log(ok ? '[startup] Beep OK' : '[startup] Beep FAILED')
      } else {
        console.warn(`[startup] VOICE_CHANNEL_ID=${VOICE_CHANNEL_ID} is not voice-based`)
      }
    } catch (err) {
      console.error('[startup] auto-join failed:', err)
    }
  } else {
    console.warn('[startup] GUILD_ID or VOICE_CHANNEL_ID not set; not auto-joining.')
  }
})

client.on(Events.MessageCreate, async (msg: Message) => {
  if (msg.author.bot || !msg.guild) return
  const content = msg.content.trim()

  const reply = (t: string) => msg.reply(t).catch(() => {})

  // await msg.delete()

  const ensureVoice = async (): Promise<VoiceCtx | null> => {
    let vc = voices.get(msg.guild!.id)
    if (vc) return vc
    const member = msg.member as GuildMember
    const vchan = member?.voice?.channel
    if (!vchan) {
      await reply('Join a voice channel first, then `!join`.')
      return null
    }
    const conn = joinVoiceChannel({
      channelId: vchan.id,
      guildId: vchan.guild.id,
      adapterCreator: vchan.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    })
    await awaitWithTimeout(
      entersState(conn, VoiceConnectionStatus.Ready, TO.discordConnReady),
      TO.discordConnReady + 1000,
      'ensureVoice: discord connection ready'
    )
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
    const runtime = makeDiscordVoiceRuntime(conn, player)
    conn.subscribe(player)
    vc = { conn, player, runtime }
    voices.set(msg.guild!.id, vc)
    return vc
  }

  if (content === '!join') {
    const vc = await ensureVoice()
    if (vc) await reply('Fine. I joined. Make it quick.')
    return
  }
  if (content === '!leave') {
    const vc = voices.get(msg.guild.id)
    if (vc) {
      try {
        vc.conn.destroy()
      } catch {}
      voices.delete(msg.guild.id)
      await reply('I’m out. Finally some peace.')
    } else await reply('I’m not even in your channel, genius.')
    return
  }
  if (content === '!beep') {
    const vc = await ensureVoice()
    if (!vc) return
    const ok = await beepTest(vc.runtime)
    await reply(ok ? '✅ Beep ok.' : '❌ Beep failed (see logs).')
    return
  }
  if (content.startsWith('!yell')) {
    const vc = await ensureVoice()
    if (!vc) return
    if (!OPENAI_API_KEY) {
      await reply('Set OPENAI_API_KEY first. Do I have to do everything?')
      return
    }
    const text = content.replace(/^!yell\s*/, '').trim() || 'Tell them off (briefly).'
    const instructions = [
      'You are Jettbot, the Angry Man roleplay bot.',
      'Always respond with *audio*. Keep it under 5 seconds.',
      'Tone: sarcastic, annoyed, witty; never hateful; mild swears okay.',
    ].join(' ')
    await reply('grumbling… fine.')
    try {
      await playAgentMessage(vc.runtime, {
        apiKey: OPENAI_API_KEY,
        text,
        instructions,
        model: DEFAULT_MODEL,
        debug: DEBUG_AUDIO,
      })
    } catch (e) {
      await reply(`That blew up: ${String(e)}`)
    }
    return
  }
  if (content === '!help') {
    await reply(
      [
        '`!join` – join your voice channel',
        '`!leave` – leave',
        '`!beep` – pipeline beep (Opus-only)',
        '`!yell [text]` – OpenAI Realtime angry audio',
      ].join('\n')
    )
  }
})

await client.login(DISCORD_TOKEN)
