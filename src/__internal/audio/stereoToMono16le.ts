import { Transform, type TransformCallback } from 'node:stream'

/**
 * Downmix PCM16LE stereo -> PCM16LE mono by averaging L/R.
 * Input:  little-endian interleaved stereo: L0 R0 L1 R1 ...
 * Output: little-endian mono: M0 M1 ...
 */
export class StereoToMono16LE extends Transform {
  private leftover: Buffer | null = null

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    // Ensure we process in multiples of 4 bytes (2ch * int16)
    let buf = chunk
    if (this.leftover) {
      buf = Buffer.concat([this.leftover, chunk])
      this.leftover = null
    }

    const usable = buf.length - (buf.length % 4)
    if (usable <= 0) {
      this.leftover = buf
      cb()
      return
    }

    const out = Buffer.allocUnsafe(usable / 2) // mono is half the bytes of stereo
    let o = 0

    for (let i = 0; i < usable; i += 4) {
      const l = buf.readInt16LE(i)
      const r = buf.readInt16LE(i + 2)
      let m = ((l + r) / 2) | 0

      if (m > 32767) m = 32767
      else if (m < -32768) m = -32768

      out.writeInt16LE(m, o)
      o += 2
    }

    this.push(out)

    if (usable < buf.length) {
      this.leftover = buf.subarray(usable)
    }

    cb()
  }

  override _flush(cb: TransformCallback) {
    this.leftover = null
    cb()
  }
}
