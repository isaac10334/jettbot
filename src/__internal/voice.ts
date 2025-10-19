import '@discordjs/opus'
import { createReadStream, promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { ChannelType, Client, Events, GatewayIntentBits } from 'discord.js'
import * as sodium from 'libsodium-wrappers'
import prism from 'prism-media'

export type BootOptions = {
  token: string
  guildId: string
  channelId: string
  debug?: boolean
  interruptPrevious?: boolean // auto-stop prior playback when a new one starts
}

export type Playback = {
  id: string
  kind: 'opus' | 'pcm' | 'file'
  stop: () => void
  done: Promise<void>
}

export type VoiceRuntime = {
  client: Client
  connection: VoiceConnection
  player: AudioPlayer
  playOpus: (opus: NodeJS.ReadableStream, opts?: { volume?: number }) => Playback
  playPcm48Stereo: (pcm: Buffer | NodeJS.ReadableStream, opts?: { volume?: number }) => Playback
  playFileOpus: (path: string, opts?: { volume?: number }) => Promise<Playback>
  shutdown: (code?: number) => Promise<never>
}

export async function bootDiscordVoice(opts: BootOptions): Promise<VoiceRuntime> {
  const { token, guildId, channelId, debug = false, interruptPrevious = true } = opts
  await sodium.ready

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  })
  const ready = new Promise<void>(res => client.once(Events.ClientReady, () => res()))
  await client.login(token)
  await ready
  if (debug) console.log('[boot] client ready')

  const guild = await client.guilds.fetch(guildId)
  if (!guild) throw new Error('Guild not found')

  const chan = await guild.channels.fetch(channelId)
  if (!chan) throw new Error('Voice channel not found')
  if (chan.type !== ChannelType.GuildVoice && chan.type !== ChannelType.GuildStageVoice)
    throw new Error(`Channel ${channelId} is not a voice/stage channel`)

  const connection = joinVoiceChannel({
    guildId: guild.id,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  })
  connection.on('stateChange', (o, n) => {
    if (debug) console.log(`[conn] ${o.status} -> ${n.status}`)
  })
  await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
  if (debug) console.log('[boot] voice ready')

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
  player.on('error', e => console.warn('[player:error]', e.message))
  player.on(AudioPlayerStatus.Buffering, () => {
    if (debug) console.log('[player] buffering')
  })
  player.on(AudioPlayerStatus.Playing, () => {
    if (debug) console.log('[player] playing')
  })
  player.on(AudioPlayerStatus.Idle, () => {
    if (debug) console.log('[player] idle')
  })
  connection.subscribe(player)

  let current: Playback | null = null

  function makePlayback(kind: Playback['kind'], resourceStop: () => void): Playback {
    const id = Math.random().toString(36).slice(2)
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const done = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    const onIdle = () => {
      cleanup()
      resolve()
    }
    const onError = (e: Error) => {
      cleanup()
      reject(e)
    }
    function cleanup(): void {
      player.off(AudioPlayerStatus.Idle, onIdle)
      player.off('error', onError as any)
      if (current && current.id === id) current = null
    }

    player.once(AudioPlayerStatus.Idle, onIdle)
    player.once('error', onError as any)

    function stop(): void {
      // only stop if this playback is still the current one (avoid racing)
      if (current && current.id === id) {
        try {
          resourceStop()
        } catch {}
        try {
          player.stop(true)
        } catch {}
      }
    }

    const pb: Playback = { id, kind, stop, done }
    if (interruptPrevious && current) current.stop()
    current = pb
    return pb
  }

  function playOpus(
    opus: NodeJS.ReadableStream,
    { volume = 1.0 }: { volume?: number } = {}
  ): Playback {
    const res = createAudioResource(opus as Readable, {
      inputType: StreamType.Opus,
      inlineVolume: true,
    })
    if (res.volume && typeof res.volume.setVolume === 'function') res.volume.setVolume(volume)
    player.play(res)
    return makePlayback('opus', () => {
      /* stream will end by stop(true) */
    })
  }

  function playPcm48Stereo(
    pcm: Buffer | NodeJS.ReadableStream,
    { volume = 1.0 }: { volume?: number } = {}
  ): Playback {
    const source = Buffer.isBuffer(pcm) ? Readable.from([pcm]) : pcm
    const enc = new prism.opus.Encoder({ rate: 48_000, channels: 2, frameSize: 960 })
    enc.on('error', (e: unknown) => console.warn('[opus:enc:error]', (e as Error)?.message ?? e))
    source.pipe(enc)
    const pb = playOpus(enc, { volume })
    return { ...pb, kind: 'pcm' }
  }

  async function playFileOpus(
    path: string,
    { volume = 1.0 }: { volume?: number } = {}
  ): Promise<Playback> {
    // Accept raw Opus, Ogg Opus, or WebM Opus; demux when needed.
    await fs.access(path)
    const rs = createReadStream(path, { highWaterMark: 1 << 15 })
    const probe = await peekBytes(path, 4)
    const magic = probe?.toString('utf8') ?? ''
    let opusStream: NodeJS.ReadableStream = rs

    // Ogg magic "OggS"; WebM/EBML magic 0x1A 45 DF A3
    if (magic === 'OggS') {
      const demux = new (prism as any).opus.OggDemuxer()
      rs.pipe(demux)
      opusStream = demux
    } else if (
      probe &&
      probe[0] === 0x1a &&
      probe[1] === 0x45 &&
      probe[2] === 0xdf &&
      probe[3] === 0xa3
    ) {
      const demux = new (prism as any).opus.WebmDemuxer()
      rs.pipe(demux)
      opusStream = demux
    } else {
      // If the extension is .ogg/.webm, we probably failed the probe; try by extension
      const ext = extname(path).toLowerCase()
      if (ext === '.ogg' || ext === '.opus') {
        const demux = new (prism as any).opus.OggDemuxer()
        rs.pipe(demux)
        opusStream = demux
      } else if (ext === '.webm') {
        const demux = new (prism as any).opus.WebmDemuxer()
        rs.pipe(demux)
        opusStream = demux
      }
    }

    const pb = playOpus(opusStream, { volume })
    return { ...pb, kind: 'file' }
  }

  async function shutdown(code = 0): Promise<never> {
    try {
      if (current) current.stop()
    } catch {}
    try {
      player.stop(true)
    } catch {}
    try {
      connection.disconnect()
    } catch {}
    try {
      connection.destroy()
    } catch {}
    try {
      await client.destroy()
    } catch {}
    setTimeout(() => process.exit(code), 50)
    return new Promise(() => {})
  }

  return { client, connection, player, playOpus, playPcm48Stereo, playFileOpus, shutdown }
}

async function peekBytes(path: string, n: number): Promise<Buffer | null> {
  const fh = await fs.open(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    if (bytesRead < n) return buf.subarray(0, bytesRead)
    return buf
  } finally {
    await fh.close()
  }
}
