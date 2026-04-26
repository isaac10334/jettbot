import { PassThrough } from 'node:stream'
import type { Client } from 'discord.js'
import prism from 'prism-media'
import { mixPcm16Mono, scalePcm16Mono } from '../audio/mix'
import { monoToStereo16LE } from '../audio/monoToStereo16le'
import { PcmClockedReadable } from '../audio/PcmClockedReadable'
import type { VoiceRuntime } from '../discord/voiceRuntime'
import { UserTrackActor } from './UserTrackActor'
import type { Logger } from '../app/logging'
import type { BotStateStore } from '../app/state'

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

export class VoiceSessionActor {
  private tracks = new Map<string, UserTrackActor>()
  private mixCursor = 0

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
      logger: Logger
      state: BotStateStore
    }
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
    this.opts.state.updateClient({ loopbackMode: mode.kind })
  }

  async start() {
    // Start playback once
    this.vr.playOpusStream(this.opusOut)
    this.opts.logger.info('voice.playback.start')
    // Force flowing mode (removes ambiguity)
    this.opusOut.resume()
    this.pcmSource.resume()
    this.opts.state.updateClient({ status: 'connected' })

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
      if (wasIn !== isIn) void this.refreshMembers()
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

    this.opts.state.updateClient({
      status: 'stopped',
      trackCount: 0,
      outputFramesPerSecond: 0,
      tracks: [],
    })
  }

  private async refreshMembers() {
    const guild = await this.client.guilds.fetch(this.guildId)
    const ch = await guild.channels.fetch(this.voiceChannelId)
    if (!ch?.isVoiceBased()) return

    const memberIds: string[] = []
    for (const [userId, member] of ch.members) {
      memberIds.push(userId)
      if (member.user.bot) continue
      this.addTrack(userId)
    }

    this.opts.state.updateExternal({ connectedMemberIds: memberIds })
  }

  private addTrack(userId: string) {
    if (this.tracks.has(userId)) return

    const t = new UserTrackActor(this.vr, userId, {
      targetFrames: this.opts.targetFrames ?? 25,
      maxFrames: this.opts.maxFrames ?? 200,
      resubscribeAfterMs: this.opts.resubscribeAfterMs ?? 2000,
      debug: this.opts.debug,
      logger: this.opts.logger.child({ userId }),
    })

    t.start()
    this.tracks.set(userId, t)
    this.opts.state.updateClient({ trackCount: this.tracks.size })

    this.opts.logger.info('voice.track.add', { userId, trackCount: this.tracks.size })
  }

  private removeTrack(userId: string) {
    const t = this.tracks.get(userId)
    if (!t) return
    t.stop()
    this.tracks.delete(userId)
    this.opts.state.updateClient({ trackCount: this.tracks.size })
    this.opts.logger.info('voice.track.remove', { userId, trackCount: this.tracks.size })
  }

  private makeOutputFrame(): Buffer {
    // Collect mono 20ms frames (1920 bytes each at 48k PCM16 mono)
    const frames: Buffer[] = []

    // Helper: push a frame only if it’s the correct size
    const pushFrame = (f: Buffer | null | undefined) => {
      if (!f) return
      if (f.length !== MONO_FRAME_BYTES) {
        if (this.opts.debug) {
          console.warn(`[mix] bad mono frame size got=${f.length} expected=${MONO_FRAME_BYTES}`)
        }
        return
      }
      frames.push(f)
    }

    if (this.mode.kind === 'solo') {
      const t = this.tracks.get(this.mode.userId)
      pushFrame(t?.popFrameTick())
    } else if (this.mode.kind === 'auto_active') {
      // “Most recent PCM activity wins”
      let best: { id: string; ts: number } | null = null
      for (const [id, t] of this.tracks) {
        if (!t.lastPcmAt) continue
        if (!best || t.lastPcmAt > best.ts) best = { id, ts: t.lastPcmAt }
      }
      if (best) pushFrame(this.tracks.get(best.id)?.popFrameTick())
    } else {
      // mix_all, but with:
      // 1) “active window” gating so silent users don’t dominate with stale buffers
      // 2) fairness: don’t always iterate Map order and starve later users
      const now = Date.now()
      const ACTIVE_WINDOW_MS = 250

      // Fairness: rotate iteration start each tick
      // (Store this as a class field, init to 0)
      // private mixCursor = 0
      const ids = Array.from(this.tracks.keys())
      if (ids.length) {
        const start = this.mixCursor % ids.length
        this.mixCursor = (this.mixCursor + 1) % ids.length

        for (let i = 0; i < ids.length; i++) {
          const id = ids[(start + i) % ids.length]!
          const t = this.tracks.get(id)
          if (!t?.lastPcmAt) continue
          if (now - t.lastPcmAt > ACTIVE_WINDOW_MS) continue
          pushFrame(t.popFrameTick())
        }
      }
    }

    // Nothing to output? Return stereo silence (encoder stays happy).
    if (frames.length === 0) return Buffer.alloc(STEREO_FRAME_BYTES, 0)

    // If multiple frames, scale down to reduce clipping when summing.
    // Rule of thumb: 1/sqrt(n) is nicer than 1/n (keeps loudness reasonable).
    // You can tune this later.
    if (frames.length > 1) {
      const gain = 1 / Math.sqrt(frames.length)
      for (let i = 0; i < frames.length; i++) frames[i] = scalePcm16Mono(frames[i]!, gain)
    }

    // Mix in mono
    const mixedMono = frames.length === 1 ? frames[0]! : mixPcm16Mono(frames)

    // Must be exactly 20ms mono
    if (mixedMono.length !== MONO_FRAME_BYTES) {
      if (this.opts.debug) {
        console.warn(
          `[mix] bad mixed mono frame size got=${mixedMono.length} expected=${MONO_FRAME_BYTES}`
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

    const tracks = Array.from(this.tracks.entries()).map(([userId, track]) => ({
      userId,
      jitterFrames: track.jitter.size(),
      primed: track.jitter.isPrimed(),
      opusPacketsPerSecond: track.opusPktsThisSec,
      pcmFramesPerSecond: track.pcmFramesThisSec,
      biggestOpusGapMs: track.biggestOpusGapMs,
      resubscribeCount: track.resubscribeCount,
      stallCount: track.stallCount,
    }))

    this.opts.state.updateClient({
      outputFramesPerSecond: made,
      trackCount: this.tracks.size,
      tracks,
    })

    this.opts.logger.info('voice.session.stats', {
      outputFramesPerSecond: made,
      trackCount: this.tracks.size,
      tracks,
      summary: rows,
    })
  }
}
