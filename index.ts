import 'dotenv/config'
import {
  createAudioPlayer,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
} from '@discordjs/voice'
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime'
import { Client, Events, GatewayIntentBits } from 'discord.js'
import { pipeAIToDiscord, pipeDiscordToAI } from './pipeAudio'

// Node-only Discord ⇄ OpenAI Realtime voice bridge
// deps: discord.js @discordjs/voice prism-media @openai/agents
// requires: ffmpeg on PATH (Windows: winget install Gyan.FFmpeg)
process.env.PRISM_OPUS_DECODER ??= '@discordjs/opus'

// ---------- ENV ----------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN!
const GUILD_ID = process.env.GUILD_ID!
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!
const MODEL = process.env.MODEL ?? 'gpt-realtime'
let shuttingDown = false
for (const [k, v] of Object.entries({
  DISCORD_TOKEN,
  GUILD_ID,
  VOICE_CHANNEL_ID,
  OPENAI_API_KEY,
})) {
  if (!v) throw new Error(`Missing env: ${k}`)
}

function generateJettbotInstructions() {
  return `You are Jettbot, an edgy, angry Discord voice bot that yells at people. You exist in a call with many users. If someone asks you if you're woke, say no and get angry.`
}

async function main() {
  // --- Discord client ---
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  await client.login(DISCORD_TOKEN)
  await new Promise<void>(res => client.once(Events.ClientReady, () => res()))
  console.log('Discord client ready.')

  const guild = await client.guilds.fetch(GUILD_ID)
  if (!guild) throw new Error('Guild not found')

  const connection: VoiceConnection = joinVoiceChannel({
    guildId: guild.id,
    channelId: VOICE_CHANNEL_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  })
  console.log('Joined voice channel.')

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  })
  player.on('error', e => console.warn('player error:', e.message))

  connection.subscribe(player)

  // --- OpenAI Realtime session ---
  const agent = new RealtimeAgent({
    name: 'Jettbot',
    instructions: generateJettbotInstructions(),
  })
  const session = new RealtimeSession(agent, {
    model: MODEL,
    config: {
      inputAudioFormat: 'pcm16', // 24k mono s16le to OpenAI
      outputAudioFormat: 'pcm16', // 24k mono s16le from OpenAI
      turnDetection: {
        type: 'semantic_vad',
        eagerness: 'medium',
        createResponse: true,
        interruptResponse: true,
      },
      voice: 'alloy',
    },
    transport: 'websocket',
  })

  await session.connect({ apiKey: OPENAI_API_KEY })

  console.log('Connected to OpenAI Realtime.')

  session.sendMessage('Hello, how are you?')
  // Discord → AI (capture users): start per-speaker pipeline on talk start.
  connection.receiver.speaking.on('start', (userId: string) => {
    pipeDiscordToAI(connection, session, userId)
  })

  pipeAIToDiscord(connection, session)

  async function gracefulExit(code = 0) {
    if (shuttingDown) return
    shuttingDown = true
    console.log('Shutting down...')
    // stop accepting & drain user pipelines
    try {
      player.stop(true)
    } catch {}
    try {
      session.close?.()
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

    await new Promise(res => setTimeout(res, 500))
    process.exit(code)
  }

  process.on('SIGINT', () => void gracefulExit(0))
  process.on('SIGTERM', () => void gracefulExit(0))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
