import { Transform, type TransformCallback } from 'node:stream'

/**
 * Re-frames PCM into exact-size chunks required by Opus encoders.
 * Node streams emit arbitrary chunk sizes; Opus encoder wants fixed frames.
 */
export class PcmFrameChunker extends Transform {
  private readonly frameBytes: number
  private buffer = Buffer.alloc(0)

  constructor(frameBytes: number) {
    super()
    this.frameBytes = frameBytes
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.buffer =
      this.buffer.length === 0 ? chunk : (Buffer.concat([this.buffer, chunk]) as ArrayBuffer<any>)

    while (this.buffer.length >= this.frameBytes) {
      this.push(this.buffer.subarray(0, this.frameBytes))
      this.buffer = this.buffer.subarray(this.frameBytes)
    }

    cb()
  }

  override _flush(cb: TransformCallback) {
    // Drop remainder (padding can create artifacts/timing drift).
    this.buffer = Buffer.alloc(0)
    cb()
  }
}
