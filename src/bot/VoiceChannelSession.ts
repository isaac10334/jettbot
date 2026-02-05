import { PassThrough } from 'node:stream'
import type { Client } from 'discord.js'
import prism from 'prism-media'
import { mixPcm16Mono } from '../audio/mix'
import { monoToStereo16LE } from '../audio/monoToStereo16le'
import { PcmClockedReadable } from '../audio/PcmClockedReadable'
import type { VoiceRuntime } from '../discord/voiceRuntime'
import { UserTrackActor } from './UserTrackActor'

const RATE = 48_000
const OPUS_FRAME_SIZE = 960 // 20ms @ 48kHz
const BYTES_PER_SAMPLE = 2

// Decoder/mixer output is mono 48k PCM16 (1ch)
const MONO_FRAME_BYTES = OPUS_FRAME_SIZE * 1 * BYTES_PER_SAMPLE // 1920
// Encoder expects stereo 48k PCM16 (2ch)
const STEREO_FRAME_BYTES = OPUS_FRAME_SIZE * 2 * BYTES_PER_SAMPLE // 3840

export type LoopbackMode =
  | { kind: 'mix_all' }
  | { kind: 'solo'; userId: string }
  | { kind: 'auto_active' }

export class VoiceChannelSession {
  private tracks = new Map<string, UserTrackActor>()

  // Opus stream that goes into Discord
  private opusOut = new PassThrough({
    highWaterMark: 1024 * 64, // small-ish; keep things realtime
  })

  // IMPORTANT: encode stereo opus
  private encoder = new prism.opus.Encoder({
    rate: RATE,
    channels: 2,
    frameSize: OPUS_FRAME_SIZE,
  })

  private statsTimer: NodeJS.Timeout | null = null
  private mode: LoopbackMode = { kind: 'mix_all' }

  private pcmSource: PcmClockedReadable

  // tiny debug counters to ensure audio is actually flowing
  private framesMadeThisSec = 0

  constructor(
    private readonly vr: VoiceRuntime,
    private readonly client: Client,
    private readonly guildId: string,
    private readonly voiceChannelId: string,
    private readonly opts: {
      debug?: boolean
      targetFrames?: number
      maxFrames?: number
      resubscribeAfterMs?: number
      outputSilenceWhenEmpty?: boolean
    } = {}
  ) {
    // Clocked PCM producer (always returns exactly 20ms stereo PCM)
    this.pcmSource = new PcmClockedReadable({
      tickMs: 20,
      frameBytes: STEREO_FRAME_BYTES,
      makeFrame: () => {
        this.framesMadeThisSec++
        return this.makeOutputFrame()
      },
    })

    // PCM -> Opus -> Discord
    this.pcmSource.pipe(this.encoder).pipe(this.opusOut)

    // Debug any pipeline errors
    this.encoder.on('error', e => console.warn('[encoder:error]', e))
    this.opusOut.on('error', e => console.warn('[opusOut:error]', e))
    this.pcmSource.on('error', e => console.warn('[pcmSource:error]', e))
  }

  setLoopbackMode(mode: LoopbackMode) {
    this.mode = mode
  }

  async start() {
    // Start playback once
    this.vr.playOpusStream(this.opusOut)
    console.log('[debug] starting opus playback stream')
    // Force flowing mode (removes ambiguity)
    this.opusOut.resume()
    this.pcmSource.resume()

    // Create tracks for users already in channel
    await this.refreshMembers()

    // Maintain tracks via voiceStateUpdate
    this.client.on('voiceStateUpdate', (oldState, newState) => {
      if (newState.guild.id !== this.guildId) return

      const oldCh = oldState.channelId
      const newCh = newState.channelId
      const userId = newState.id

      if (userId === this.client.user?.id) return

      const wasIn = oldCh === this.voiceChannelId
      const isIn = newCh === this.voiceChannelId

      if (!wasIn && isIn) this.addTrack(userId)
      if (wasIn && !isIn) this.removeTrack(userId)
    })

    if (this.opts.debug) {
      this.statsTimer = setInterval(() => this.printStats(), 1000)
    }
  }

  stop() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null

    for (const t of this.tracks.values()) t.stop()
    this.tracks.clear()

    try {
      this.pcmSource.destroy()
    } catch {}
    try {
      this.encoder.destroy()
    } catch {}
    try {
      this.opusOut.end()
    } catch {}
  }

  private async refreshMembers() {
    const guild = await this.client.guilds.fetch(this.guildId)
    const ch = await guild.channels.fetch(this.voiceChannelId)
    if (!ch?.isVoiceBased()) return

    for (const [userId, member] of ch.members) {
      if (member.user.bot) continue
      this.addTrack(userId)
    }
  }

  private addTrack(userId: string) {
    if (this.tracks.has(userId)) return

    const t = new UserTrackActor(this.vr, userId, {
      targetFrames: this.opts.targetFrames ?? 25,
      maxFrames: this.opts.maxFrames ?? 200,
      resubscribeAfterMs: this.opts.resubscribeAfterMs ?? 2000,
      debug: this.opts.debug,
    })

    t.start()
    this.tracks.set(userId, t)

    if (this.opts.debug) console.log(`[session] track add ${userId}`)
  }

  private removeTrack(userId: string) {
    const t = this.tracks.get(userId)
    if (!t) return
    t.stop()
    this.tracks.delete(userId)
    if (this.opts.debug) console.log(`[session] track remove ${userId}`)
  }

  private makeOutputFrame(): Buffer {
    const frames: Buffer[] = []

    // How long after last PCM we still consider a user "active" for mixing
    const ACTIVE_WINDOW_MS = 250

    if (this.mode.kind === 'solo') {
      const t = this.tracks.get(this.mode.userId)
      const f = t?.popFrameTick()
      if (f) frames.push(f)
    } else if (this.mode.kind === 'auto_active') {
      // Choose the most recently-active track
      let best: { id: string; ts: number } | null = null

      for (const [id, t] of this.tracks) {
        if (!t.lastPcmAt) continue
        if (!best || t.lastPcmAt > best.ts) best = { id, ts: t.lastPcmAt }
      }

      if (best) {
        const f = this.tracks.get(best.id)?.popFrameTick()
        if (f) frames.push(f)
      }
    } else {
      // mix_all
      const now = Date.now()

      for (const t of this.tracks.values()) {
        if (!t.lastPcmAt) continue
        if (now - t.lastPcmAt > ACTIVE_WINDOW_MS) continue

        const f = t.popFrameTick()
        if (f) frames.push(f)
      }
    }

    // If no audio, return stereo silence (keeps encoder + discord happy)
    if (frames.length === 0) return Buffer.alloc(STEREO_FRAME_BYTES, 0)

    // Mix in mono
    let mixedMono = frames.length === 1 ? frames[0]! : mixPcm16Mono(frames)

    // Prevent clipping when multiple speakers overlap.
    // (This is *the* main reason you hear stereo junk / crunchy artifacts.)
    if (frames.length > 1) {
      mixedMono = scalePcm16Mono(mixedMono, 1 / frames.length)
    }

    // Must be exactly 20ms mono
    if (mixedMono.length !== MONO_FRAME_BYTES) {
      if (this.opts.debug) {
        console.warn(
          `[mix] bad mono frame size got=${mixedMono.length} expected=${MONO_FRAME_BYTES}`
        )
      }
      return Buffer.alloc(STEREO_FRAME_BYTES, 0)
    }

    // Convert mono -> stereo PCM16 (duplicate L/R)
    const stereo = monoToStereo16LE(mixedMono)

    // Must be exactly 20ms stereo
    if (stereo.length !== STEREO_FRAME_BYTES) {
      if (this.opts.debug) {
        console.warn(
          `[mix] bad stereo frame size got=${stereo.length} expected=${STEREO_FRAME_BYTES}`
        )
      }
      return Buffer.alloc(STEREO_FRAME_BYTES, 0)
    }

    return stereo
  }

  private printStats() {
    const rows: string[] = []

    for (const [id, t] of this.tracks) {
      rows.push(
        `${id} opusPkts/s=${t.opusPktsThisSec} pcmFrames/s=${t.pcmFramesThisSec} jitter=${t.jitter.size()} primed=${t.jitter.isPrimed()} biggestGap=${t.biggestOpusGapMs}ms resubs=${t.resubscribeCount} stalls=${t.stallCount}`

        // `${id} pcmFrames/s=${t.pcmFramesThisSec} jitter=${t.jitter.size()} primed=${t.jitter.isPrimed()} biggestOpusGap=${t.biggestOpusGapMs}ms`
      )
      t.pcmFramesThisSec = 0
      t.biggestOpusGapMs = 0
      t.opusPktsThisSec = 0
    }

    const made = this.framesMadeThisSec
    this.framesMadeThisSec = 0

    console.log(`[session] outFrames/s=${made} | ${rows.join(' | ')}`)
  }
}
