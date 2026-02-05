import { PassThrough, type Readable } from 'node:stream'
import prism from 'prism-media'
import { OpusPacer } from './opusPacer'
import { PcmFrameChunker } from './pcmFrameChunker'

export function opusInToOpusOutForDiscord(opts: {
  opusIn: Readable
  channels?: 1 | 2
  rate?: 48000
  frameSize?: 960
  pace?: boolean
}): { opusOut: PassThrough; stop: () => void } {
  const channels = opts.channels ?? 1
  const rate = opts.rate ?? 48_000
  const frameSize = opts.frameSize ?? 960

  const bytesPerSample = 2
  const frameBytes = frameSize * channels * bytesPerSample

  const decoder = new prism.opus.Decoder({ frameSize, channels, rate })
  const chunker = new PcmFrameChunker(frameBytes)
  const encoder = new prism.opus.Encoder({ frameSize, channels, rate })

  const pacer = opts.pace === false ? null : new OpusPacer({ tickMs: 20, maxBufferedPackets: 200 })

  const opusOut = new PassThrough({
    highWaterMark: 1024 * 1024, // avoid tiny backpressure stalls
  })

  // inbound Opus -> PCM -> framed PCM -> Opus -> (pace) -> out
  const encoded = opts.opusIn.pipe(decoder).pipe(chunker).pipe(encoder)
  if (pacer) encoded.pipe(pacer).pipe(opusOut)
  else encoded.pipe(opusOut)

  const stop = () => {
    try {
      opts.opusIn.destroy()
    } catch {}
    try {
      decoder.destroy()
    } catch {}
    try {
      chunker.destroy()
    } catch {}
    try {
      encoder.destroy()
    } catch {}
    try {
      pacer?.destroy()
    } catch {}
    try {
      opusOut.end()
    } catch {}
  }

  opts.opusIn.once('error', stop)
  decoder.once('error', stop)
  encoder.once('error', stop)
  pacer?.once('error', stop)
  opusOut.once('error', stop)

  return { opusOut, stop }
}
