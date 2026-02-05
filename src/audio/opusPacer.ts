import { Transform, type TransformCallback } from 'node:stream'

/**
 * Paces Opus packets so downstream (Discord AudioPlayer) gets steady timing.
 * Useful when decode->encode produces bursty output.
 *
 * Assumptions:
 * - Input chunks are complete Opus packets (prism encoder emits packet-sized chunks).
 * - Target cadence is 20ms (50 packets/sec) for 48k Opus frameSize=960.
 */
export class OpusPacer extends Transform {
  private readonly tickMs: number
  private readonly maxBufferedPackets: number
  private queue: Buffer[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(opts?: { tickMs?: number; maxBufferedPackets?: number }) {
    super({ readableHighWaterMark: 128 * 1024, writableHighWaterMark: 128 * 1024 })
    this.tickMs = opts?.tickMs ?? 20
    this.maxBufferedPackets = opts?.maxBufferedPackets ?? 200 // ~4s of audio
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    // Buffer packets
    this.queue.push(chunk)

    // Drop oldest if we’re falling behind (keeps latency bounded)
    if (this.queue.length > this.maxBufferedPackets) {
      const drop = this.queue.length - this.maxBufferedPackets
      this.queue.splice(0, drop)
    }

    if (!this.timer) this.startTimer()
    cb()
  }

  override _flush(cb: TransformCallback) {
    this.stopTimer()
    this.queue = []
    cb()
  }

  private startTimer() {
    this.timer = setInterval(() => {
      const pkt = this.queue.shift()
      if (pkt) this.push(pkt)

      // If no packets queued, stop ticking to avoid keeping process alive.
      if (this.queue.length === 0) {
        this.stopTimer()
      }
    }, this.tickMs)
  }

  private stopTimer() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}
