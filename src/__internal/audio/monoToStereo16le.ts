export function monoToStereo16LE(mono: Buffer): Buffer {
  // mono: int16le samples
  const samples = mono.length >> 1
  const out = Buffer.allocUnsafe(samples * 4)

  for (let i = 0; i < samples; i++) {
    const s = mono.readInt16LE(i * 2)
    out.writeInt16LE(s, i * 4) // L
    out.writeInt16LE(s, i * 4 + 2) // R
  }

  return out
}
