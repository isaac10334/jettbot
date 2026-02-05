import { Readable } from 'node:stream'

export class PcmClockedReadable extends Readable {
  private running = false
  private nextAt = 0

  constructor(
    private readonly opts: {
      tickMs: number // 20
      frameBytes: number // 3840 stereo
      makeFrame: () => Buffer // must always return exactly frameBytes
    }
  ) {
    super({
      highWaterMark: opts.frameBytes * 3, // small, realtime
    })
  }

  override _read() {
    if (this.running) return
    this.running = true
    this.nextAt = performance.now()
    this.loop()
  }

  private loop() {
    if (!this.running) return

    const now = performance.now()
    const delay = Math.max(0, this.nextAt - now)

    setTimeout(() => {
      if (!this.running) return

      const frame = this.opts.makeFrame()

      if (frame.length !== this.opts.frameBytes) {
        throw new Error(
          `PcmClockedReadable: bad frame size ${frame.length} (expected ${this.opts.frameBytes})`
        )
      }

      const ok = this.push(frame)

      this.nextAt += this.opts.tickMs

      // If consumer applied backpressure, wait for next _read call
      if (!ok) {
        this.running = false
        return
      }

      this.loop()
    }, delay)
  }

  override _destroy(_err: Error | null, cb: (error?: Error | null) => void) {
    this.running = false
    cb(null)
  }
}
