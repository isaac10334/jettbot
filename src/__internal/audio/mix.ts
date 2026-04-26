export function silencePcm16Mono(bytes: number): Buffer {
  return Buffer.alloc(bytes, 0)
}

export function mixPcm16Mono(frames: readonly Buffer[]): Buffer {
  if (frames.length === 0) return Buffer.alloc(0)
  if (frames.length === 1) return Buffer.from(frames[0]!)

  const len = frames[0]!.length
  const out = Buffer.allocUnsafe(len)

  for (let i = 0; i < len; i += 2) {
    let acc = 0
    for (const f of frames) acc += f.readInt16LE(i)

    // normalize (simple average)
    acc = (acc / frames.length) | 0

    if (acc > 32767) acc = 32767
    else if (acc < -32768) acc = -32768

    out.writeInt16LE(acc, i)
  }

  return out
}

export function scalePcm16Mono(frame: Buffer, gain: number): Buffer {
  if (gain === 1) return frame

  const out = Buffer.allocUnsafe(frame.length)
  for (let i = 0; i < frame.length; i += 2) {
    const s = frame.readInt16LE(i)
    let v = Math.round(s * gain)
    if (v > 32767) v = 32767
    if (v < -32768) v = -32768
    out.writeInt16LE(v, i)
  }
  return out
}
