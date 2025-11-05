// jettbot.ts
// One-path audio: Realtime PCM16/24k/mono → FFmpeg 48k/stereo → Opus → Discord (StreamType.Opus)

/* -------------------------------- Boot & Deps ------------------------------- */
import {
  awaitWithTimeout,
  createPcm24MonoToOpus48Stereo,
  makeDiscordVoiceRuntime,
  opus48StereoToPcm24Mono,
  sanityCheckFfmpeg,
  TO,
  type VoiceRuntime,
} from './audio/io'
import 'dotenv/config'
import '@discordjs/opus'
import { Readable } from 'node:stream'
import {
  createAudioPlayer,
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
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
import { reportUtteranceTool } from './core/tools'
import type { TranscriptPacket } from './core/types'

/* --------------------------- Configuration & Flags -------------------------- */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const GUILD_ID = process.env.GUILD_ID ?? ''
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID ?? ''
const DEFAULT_MODEL = process.env.MODEL ?? 'gpt-realtime'
const DEBUG_AUDIO = !!(process.env.DEBUG && process.env.DEBUG !== '0')
const VOICE = process.env.VOICE ?? 'onyx'

// Temp debugging - one user voice only (me)
const TARGET_USER_ID = '377268939035639810'
// How long of silence to let the receiver consider "end of utterance"
const RX_SILENCE_MS = 600

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env')
  process.exit(1)
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
export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
// PCM16 mono @ 24k => 48 bytes per ms
function bytesToMs24kMono(bytes: number): number {
  return (bytes / 2 /*bytes/sample*/ / 24000) /*samples/s*/ * 1000
}

function pcm24SilenceMs(ms: number): Buffer {
  const bytes = Math.max(0, Math.ceil(ms) * 48)
  return Buffer.alloc(bytes, 0)
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

/* --------------------------------- Users Speaking Wiring -------------------------------- */
function wireInputStreamingForGuild(guildId: string) {
  const vc = voices.get(guildId)
  if (!vc) return
  const { conn } = vc
  const rcv = conn.receiver

  rcv.speaking.on('start', async (userId: string) => {
    try {
      const key = `${guildId}:${userId}`
      const guild = await client.guilds.fetch(guildId)
      const channelId = (conn as any).joinConfig?.channelId as string | undefined
      const channel = channelId ? await guild.channels.fetch(channelId) : null
      const member = await guild.members.fetch(userId).catch(() => null)

      const speakerTag = member?.user?.id ?? userId // stable id
      const guildName = guild.name
      const channelName = channel?.isVoiceBased() ? channel.name : '(unknown channel)'

      // Ensure PSS
      if (!speakers.has(key)) {
        if (!OPENAI_API_KEY) return
        const session = await createSpeakerSession({
          apiKey: OPENAI_API_KEY,
          model: DEFAULT_MODEL,
          guildName,
          channelName,
          speakerTag,
        })
        speakers.set(key, { session, userTag: speakerTag })
      }

      // Subscribe to the user's inbound Opus stream
      const opus = rcv.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: RX_SILENCE_MS },
      })

      // Decode → PCM24k mono (your helper)
      const pcm24 = await opus48StereoToPcm24Mono(opus)

      // Feed to session using sendAudio/commit
      const { session } = speakers.get(key)!
      let accBytes = 0
      let lastChunk: Buffer | null = null

      pcm24.on('data', (chunk: Buffer) => {
        accBytes += chunk.length

        if (accBytes < 2) return

        if (lastChunk && lastChunk.length & 1)
          lastChunk = lastChunk.subarray(0, lastChunk.length - 1)

        // If we already have a previous chunk, send it now (no commit)
        if (lastChunk) {
          session.sendAudio(toArrayBuffer(lastChunk))
        }
        lastChunk = chunk // keep one-chunk lookahead
      })

      pcm24.once('end', () => {
        // Nothing captured? bail quietly.
        if (accBytes === 0 || !lastChunk) return

        // Ensure the *committing* call contains audio.
        const accMs = bytesToMs24kMono(accBytes)

        if (accMs < 100) {
          // Pad to 100ms and commit in one go
          const pad = pcm24SilenceMs(100 - accMs)
          // Concatenate lastChunk + pad so commit call has bytes
          const commitBuf = Buffer.concat([lastChunk, pad])
          session.sendAudio(toArrayBuffer(commitBuf), { commit: true })
        } else {
          // Commit on the final real audio chunk (no zero-length commits)
          session.sendAudio(toArrayBuffer(lastChunk), { commit: true })
        }

        lastChunk = null
      })
    } catch (e) {
      console.warn('[rx]', e)
    }
  })
}

function makeJettbotSession(guildName: string, channelName: string) {
  const baseInstructions = [
    `You're Jettbot inside Discord server "${guildName}", voice channel "${channelName}".`,
    `Transcribe and respond briefly in voice. Keep replies under 5 seconds.`,
    `If multiple people talk, respond to the current speaker only. Roleplay as an angry, yet not hateful AI. Say hilariously funny jabs and angry rants, but keep them short!`,
  ].join(' ')

  const agent = new RealtimeAgent({
    name: 'Jettbot',
    instructions: baseInstructions,
  })

  return new RealtimeSession(agent, {
    transport: 'websocket',
    model: 'gpt-realtime',
    config: {
      audio: {
        input: {
          turnDetection: {
            type: 'server_vad',
            silenceDurationMs: RX_SILENCE_MS, // 600 is fine for now
            threshold: 0.5,
            createResponse: true, // <-- AUTOMATICALLY create response on VAD end
            interruptResponse: true,
          },
        },
        output: { format: 'pcm16', voice: VOICE },
      },
    },
  })
}

async function createInputSessionForSpeaker(opts: {
  apiKey: string
  guildName: string
  channelName: string
  speakerTag: string
  debug?: boolean
}) {
  const { apiKey, guildName, channelName, speakerTag, debug } = opts

  const session = makeJettbotSession(guildName, channelName)

  await awaitWithTimeout(session.connect({ apiKey, model }), TO.rtConnect, 'realtime rx connect')
  if (debug) console.log('[rt:rx] connected')

  // Only send supported fields
  session.transport.updateSessionConfig?.({
    instructions: `${baseInstructions} Current speaker is "${speakerTag}".`,
  })

  // Optional breadcrumb (no metadata field)
  session.transport.sendEvent?.({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: `(system) ${speakerTag} started speaking` }],
    },
  } as any)

  return session
}

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
    config: { audio: { output: { format: 'pcm16', voice: VOICE } } }, // PCM16 mono @ 24k
  })
  await awaitWithTimeout(session.connect({ apiKey, model }), TO.rtConnect, 'realtime connect')
  if (debug) console.log('[rt] connected')

  /* EXPERIMENT 10/19 2PM */
  // session.transport.updateSessionConfig({
  //   // audio
  //   // instructions
  //   // model
  //   // outputModalities
  //   // prompt
  //   // providerData
  //   // toolChoice
  //   // tools
  //   // tracing
  //   // voice
  // })
  // session.sendMessage(
  //   {
  //     content: 'blah',
  //     role: 'test',
  //   },
  //   {
  //     asdf: 'hi',
  //   }
  // )
  // session.on('history_added', item => {
  //   // item.itemId
  //   // item.type
  //   // I think you get to set the type of this?
  // })
  // // session.on('history_updated')
  // session.sendAudio()
  /* END EXP */

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
      const pb = voice.playOpus(bridge.opus) // start playback first
      pb.done.catch(() => {}).then(endAll)

      // Debug opus stuff
      // awaitWithTimeout(bridge.firstPacket, TO.opusWarmup, 'realtime: opus first packet')
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

// Speaking map and whatnot
// top of file (near voices map)
type SpeakerCtx = {
  session: RealtimeSession
  userTag: string
}
const speakers = new Map<string, SpeakerCtx>() // key: `${guildId}:${userId}`

// Minimal bus -> just call handlePacket(pkt)
async function handlePacket(pkt: TranscriptPacket) {
  // Simple cross-talk policy: if 2+ finals within 1s and overlap, ask to pause or move channel
  // (Replace with a real Conductor later)
  const vc = voices.get(GUILD_ID)
  if (!vc) return

  // If mentionsBot or high toxicity, nudge priority
  const priority = (pkt.mentionsBot ? 2 : 0) + (pkt.toxicity && pkt.toxicity > 0.7 ? 1 : 0)

  // For now: immediately TTS a short acknowledgement when mentionsBot
  if (pkt.mentionsBot && OPENAI_API_KEY) {
    await playAgentMessage(vc.runtime, {
      apiKey: OPENAI_API_KEY,
      model: DEFAULT_MODEL,
      text: `Okay ${pkt.userId} — ${pkt.intent ? `I got a ${pkt.intent}` : 'got it'}.`,
      instructions:
        "You are Jettbot. Audio only. Keep it under 3 seconds. Acknowledge briefly; don't repeat the user's words.",
      debug: DEBUG_AUDIO,
    })
  }
}
// end speaking map and whatnot

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
        wireInputStreamingForGuild(guild.id)

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
async function createSpeakerSession(args: {
  apiKey: string
  model: string
  guildName: string
  channelName: string
  speakerTag: string // can be the Discord user id
}) {
  const { apiKey, model, guildName, channelName, speakerTag } = args

  const agent = new RealtimeAgent({
    name: 'PSS',
    instructions: [
      `You transcribe ONLY speaker "${speakerTag}" in "${guildName}#${channelName}".`,
      `Rules:`,
      `- Stream partials; NEVER output audio.`,
      `- When turn ends (VAD commit), call report_utterance with analytics {text, confidence, ...}.`,
    ].join('\n'),
    tools: [reportUtteranceTool],
  })

  const session = new RealtimeSession(agent, {
    transport: 'websocket',
    model,
    // Disable output audio at the session level
    config: {
      audio: {
        output: { format: 'none' },
      },
    },
  })

  await session.connect({ apiKey, model })

  // === TOOL APPROVAL FLOW ===
  session.on('tool_approval_requested', async (_ctx, _agent, approvalReq) => {
    // Approve only our own tool(s); you can add allow-listing here
    await session.approve(approvalReq.approvalItem, { alwaysApprove: true })
  })

  // === TOOL RESULTS (analytics JSON) ===
  session.on('agent_tool_end', async (_ctx, _agent, tool, result, details) => {
    if (tool.name !== 'report_utterance') return
    // result is a string (per .d.ts) – assume tool returned JSON
    let data: any = {}
    try {
      data = result ? JSON.parse(result) : {}
    } catch {
      /* tolerate */
    }

    const pkt: TranscriptPacket = {
      type: 'utterance',
      userId: speakerTag,
      ts: Date.now(),
      text: String(data.text ?? ''),
      isFinal: true,
      confidence: Number(data.confidence ?? 0.8),
      lang: data.lang,
      accent: data.accent,
      emotion: data.emotion,
      speakingRateWpm: numOrU(data.speakingRateWpm),
      avgPitchHz: numOrU(data.avgPitchHz),
      snrDb: numOrU(data.snrDb),
      toxicity: numOrU(data.toxicity),
      keywords: Array.isArray(data.keywords) ? data.keywords.slice(0, 5) : undefined,
      mentionsBot: !!data.mentionsBot,
      intent: data.intent,
    }

    // Hand to your Conductor (or a stub for now)
    handlePacket(pkt).catch(() => {})
  })

  // Optional: watch history if you want debug visibility
  // session.on("history_added", (item: RealtimeItem) => { ... });

  // Errors
  session.on('error', e => {
    console.warn('[pss:error]', e.error ?? e)
  })

  return session

  function numOrU(x: any) {
    const n = Number(x)
    return Number.isFinite(n) ? n : undefined
  }
}

await client.login(DISCORD_TOKEN)

function teardown(reason = 'shutdown') {
  try {
    // stop players & destroy connections
    for (const [gid, vc] of voices) {
      try {
        vc.player.stop(true)
      } catch {}
      try {
        vc.conn.destroy()
      } catch {}
      voices.delete(gid)
    }
    // discord client
    try {
      client.destroy()
    } catch {}
  } finally {
    console.log(`[shutdown] ${reason}`)
    // On Windows, sometimes signals are weird; force exit.
    process.exit(0)
  }
}

// Common signalss
process.on('SIGINT', () => teardown('SIGINT'))
process.on('SIGTERM', () => teardown('SIGTERM'))
// Some shells send this on terminal close (not always on Windows)
try {
  process.on('SIGHUP', () => teardown('SIGHUP'))
} catch {}

process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err)
  teardown('uncaughtException')
})
process.on('unhandledRejection', err => {
  console.error('[unhandledRejection]', err)
  teardown('unhandledRejection')
})

// If the parent (tsdown) kills the child w/o signals,
// Node will still run 'beforeExit' when the event loop empties.
process.on('beforeExit', () => teardown('beforeExit'))
