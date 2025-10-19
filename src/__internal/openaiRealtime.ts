// __internal/openaiRealtime.ts
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime'
import type { TransportLayerAudio } from '@openai/agents/realtime'
import { createPcm24MonoToOpus48Stereo } from './rtAudio'
import type { Playback, VoiceRuntime } from './voice'

type Opts = {
  apiKey: string
  model?: string
  text?: string
  instructions?: string
  volume?: number // 0..n (1.0 = unity)
  debug?: boolean
  timeoutMs?: number // hard cap for the whole turn
  noAudioMs?: number // resolve if no audio arrives within this window
}

/** Send text, stream model audio to Discord, and resolve when playback drains (or times out). */
export async function playAgentMessage(voice: VoiceRuntime, opts: Opts): Promise<void> {
  const {
    apiKey,
    model = 'gpt-realtime',
    text = 'Say one short sentence, out loud.',
    instructions = 'Always respond with speech audio; keep answers under 5 seconds.',
    volume = 1.0,
    debug = false,
    timeoutMs = 15_000,
    noAudioMs = 8_000,
  } = opts

  // Minimal + explicit: WebSocket transport; we only RECEIVE audio
  const session = new RealtimeSession(new RealtimeAgent({ name: 'Jettbot', instructions }), {
    transport: 'websocket',
    model,
    config: {
      audio: { output: { format: 'pcm16', voice: 'alloy' } }, // PCM16 mono @ 24kHz
    },
  })

  await session.connect({ apiKey, model })
  if (debug) console.log('[rt] connected')

  let started = false
  let closed = false
  let bridge: ReturnType<typeof createPcm24MonoToOpus48Stereo> | null = null
  let playback: Playback | null = null

  // Single resolution gate
  let resolveOuter!: (ok: boolean) => void
  const done = new Promise<boolean>(res => (resolveOuter = res))
  const endAll = (ok: boolean) => {
    if (closed) return
    closed = true
    try {
      bridge?.end()
    } catch {}
    try {
      bridge?.close()
    } catch {}
    try {
      session.close()
    } catch {}
    resolveOuter(ok)
  }

  // Watchdogs
  const tNoAudio = setTimeout(() => {
    if (!started) {
      if (debug) console.warn('[rt] no audio within', noAudioMs, 'ms')
      endAll(false)
    }
  }, noAudioMs)
  const tHard = setTimeout(() => {
    if (debug) console.warn('[rt] hard timeout at', timeoutMs, 'ms')
    endAll(false)
  }, timeoutMs)
  const clearTimers = () => {
    clearTimeout(tNoAudio)
    clearTimeout(tHard)
  }

  // Events
  session.on('audio_start', () => {
    if (debug) console.log('[rt] audio_start')
  })

  session.on('audio', (ev: TransportLayerAudio) => {
    // PCM16 mono @ 24kHz from the model
    const buf = Buffer.from(new Uint8Array(ev.data))

    if (!started) {
      started = true
      bridge = createPcm24MonoToOpus48Stereo()
      bridge.ready
        .then(() => {
          playback = voice.playOpus(bridge!.opus, { volume })
          playback.done.then(
            () => {
              clearTimers()
              endAll(true)
            },
            () => {
              clearTimers()
              endAll(true)
            }
          )
        })
        .catch(err => {
          console.warn('[rt] ffmpeg/opus bridge failed:', err)
          clearTimers()
          endAll(false)
        })
    }

    bridge!.write(buf)
  })

  session.on('audio_stopped', () => {
    if (debug) console.log('[rt] audio_stopped')
    // Let the Discord player drain; playback.done will resolve the outer promise.
  })
  session.on('audio_interrupted', () => {
    if (debug) console.log('[rt] audio_interrupted')
  })
  session.on('agent_end', () => {
    if (debug) console.log('[rt] agent_end')
  })
  session.on('error', e => {
    console.warn('[rt:error]', e?.error ?? e)
    // Don’t end early here; allow any pending audio to finish via playback.done.
  })

  // Kick the turn
  session.sendMessage(text)

  const ok = await done
  clearTimers()
  if (debug) console.log('[rt] finished ok=', ok)
}
