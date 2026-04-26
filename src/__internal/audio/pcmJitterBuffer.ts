export class PcmJitterBuffer {
  private q: Buffer[] = []
  private primed = false

  constructor(
    private readonly opts: {
      targetFrames: number // e.g. 8 = 160ms
      maxFrames: number // e.g. 60 = 1.2s
    }
  ) {}

  push(frame: Buffer) {
    this.q.push(frame)

    if (this.q.length > this.opts.maxFrames) {
      const drop = this.q.length - this.opts.maxFrames
      this.q.splice(0, drop)
    }

    if (!this.primed && this.q.length >= this.opts.targetFrames) {
      this.primed = true
    }
  }

  /**
   * Called once per output tick (20ms).
   * - before primed: returns null until buffered enough
   * - after primed: returns a frame each tick if available
   * - if underflow: unprimes and returns null (forces rebuffer)
   */
  popTick(): Buffer | null {
    if (!this.primed) return null

    const f = this.q.shift() ?? null
    if (!f) {
      this.primed = false // rebuffer
      return null
    }
    return f
  }

  size() {
    return this.q.length
  }

  clear() {
    this.q = []
    this.primed = false
  }

  isPrimed() {
    return this.primed
  }
}
