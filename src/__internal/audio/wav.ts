import fs from 'node:fs'

export function writeWavHeader(opts: {
  sampleRate: number
  channels: number
  bitsPerSample: 16
  dataBytes: number
}): Buffer {
  const { sampleRate, channels, bitsPerSample, dataBytes } = opts

  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)

  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)

  return header
}

export function savePcm16AsWav(path: string, pcm: Buffer, sampleRate = 48_000, channels = 1) {
  const header = writeWavHeader({
    sampleRate,
    channels,
    bitsPerSample: 16,
    dataBytes: pcm.length,
  })
  fs.writeFileSync(path, Buffer.concat([header, pcm]))
}
