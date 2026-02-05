// import type { Readable } from 'node:stream'
// import { EndBehaviorType } from '@discordjs/voice'
// import { opusInToOpusOutForDiscord } from '../audio/opusPipeline'
// import type { VoiceRuntime } from '../discord/voiceRuntime'

// export class LoopbackActor {
//   private activeUserId: string | null = null
//   private activeStop: (() => void) | null = null

//   private pendingSpeakerId: string | null = null

//   private lastPacketAt = 0
//   private activeSince = 0

//   private watchdog: NodeJS.Timeout | null = null

//   // Debug: packet cadence
//   private packetsThisSec = 0
//   private biggestGapMs = 0
//   private lastPacketTs = 0
//   private statsTimer: NodeJS.Timeout | null = null

//   constructor(
//     private readonly vr: VoiceRuntime,
//     private readonly opts: {
//       packetTimeoutMs: number // stop when no packets for this long
//       watchdogTickMs: number
//       reencode: boolean
//       channels?: 1 | 2
//       pace?: boolean

//       minHoldMs?: number // prevent thrashy switching
//       debug?: boolean
//     }
//   ) {}

//   start() {
//     const { receiver } = this.vr

//     receiver.speaking.on('start', (userId: string) => {
//       // If nothing active, take the floor.
//       if (!this.activeUserId) {
//         this.startTrack(userId)
//         return
//       }

//       // If the current speaker is active, do not interrupt.
//       // Just remember who *wants* the floor next.
//       if (this.activeUserId !== userId) {
//         this.pendingSpeakerId = userId
//       }
//     })

//     // Watchdog: stop based on packets, not speaking.end.
//     this.watchdog = setInterval(() => {
//       if (!this.activeUserId) return

//       const dt = Date.now() - this.lastPacketAt
//       if (this.lastPacketAt !== 0 && dt > this.opts.packetTimeoutMs) {
//         // Current speaker is truly inactive (no packets).
//         this.stopActive(`packet timeout (${dt}ms)`)
//         const next = this.pendingSpeakerId
//         this.pendingSpeakerId = null
//         if (next) this.startTrack(next)
//       }
//     }, this.opts.watchdogTickMs)

//     if (this.opts.debug) {
//       this.statsTimer = setInterval(() => {
//         if (this.activeUserId) {
//           console.log(
//             `[loopback] active=${this.activeUserId} pkts/s=${this.packetsThisSec} biggestGap=${this.biggestGapMs}ms pending=${this.pendingSpeakerId ?? '-'}`
//           )
//         }
//         this.packetsThisSec = 0
//         this.biggestGapMs = 0
//       }, 1000)
//     }
//   }

//   stop() {
//     if (this.watchdog) clearInterval(this.watchdog)
//     this.watchdog = null

//     if (this.statsTimer) clearInterval(this.statsTimer)
//     this.statsTimer = null

//     this.stopActive('actor stop')
//     this.pendingSpeakerId = null
//   }

//   private startTrack(userId: string) {
//     // Respect minimum hold time for the *current* speaker:
//     // if we are still within hold window, defer the switch.
//     if (this.activeUserId) {
//       const hold = this.opts.minHoldMs ?? 0
//       const heldFor = Date.now() - this.activeSince
//       if (heldFor < hold) {
//         this.pendingSpeakerId = userId
//         return
//       }
//       this.stopActive(`switch -> ${userId}`)
//     }

//     const opusIn = this.vr.receiver.subscribe(userId, {
//       end: { behavior: EndBehaviorType.Manual },
//     })

//     this.activeUserId = userId
//     this.activeSince = Date.now()

//     this.lastPacketAt = 0
//     this.lastPacketTs = 0
//     this.packetsThisSec = 0
//     this.biggestGapMs = 0

//     opusIn.on('data', (chunk: Buffer) => {
//       if (!chunk.length) return

//       const now = Date.now()
//       this.lastPacketAt = now
//       this.packetsThisSec++

//       if (this.lastPacketTs) {
//         const gap = now - this.lastPacketTs
//         if (gap > this.biggestGapMs) this.biggestGapMs = gap
//       }
//       this.lastPacketTs = now
//     })

//     let out: Readable
//     let stopPipeline: () => void

//     if (this.opts.reencode) {
//       const piped = opusInToOpusOutForDiscord({
//         opusIn,
//         channels: this.opts.channels ?? 1,
//         pace: this.opts.pace ?? true,
//       })
//       out = piped.opusOut
//       stopPipeline = piped.stop
//     } else {
//       out = opusIn
//       stopPipeline = () => {
//         try {
//           opusIn.destroy()
//         } catch {}
//       }
//     }

//     this.vr.playOpusStream(out)
//     this.activeStop = stopPipeline

//     opusIn.once('error', () => this.stopActive('opusIn error'))
//   }

//   private stopActive(reason: string) {
//     if (!this.activeUserId) return

//     if (this.opts.debug) {
//       console.log(`[loopback] stop ${this.activeUserId}: ${reason}`)
//     }

//     try {
//       this.activeStop?.()
//     } catch {}

//     this.activeUserId = null
//     this.activeStop = null
//     this.lastPacketAt = 0
//     this.activeSince = 0
//     this.lastPacketTs = 0
//   }
// }
