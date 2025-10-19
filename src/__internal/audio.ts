import { Readable } from 'node:stream'
import { createPcm24MonoToOpus48Stereo } from './rtAudio'
import type { VoiceRuntime } from './voice'

export function makeBeepPCM48kStereo(
  durationSec = 1,
  freqL = 440,
  freqR = 660,
  volume = 0.35
): Buffer {
  const SR = 48_000
  const N = Math.max(1, Math.floor(SR * durationSec))
  const out = Buffer.allocUnsafe(N * 4)
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const l = Math.sin(2 * Math.PI * freqL * t) * volume
    const r = Math.sin(2 * Math.PI * freqR * t) * volume
    const li = (Math.max(-1, Math.min(1, l)) * 0x7fff) | 0
    const ri = (Math.max(-1, Math.min(1, r)) * 0x7fff) | 0
    out.writeInt16LE(li, (i << 2) + 0)
    out.writeInt16LE(ri, (i << 2) + 2)
  }
  return out
}

export function makeBeepPCM24kMono(durationSec = 0.6, freq = 660, vol = 0.35): Buffer {
  const SR = 24_000
  const N = Math.max(1, Math.floor(SR * durationSec))
  const out = Buffer.allocUnsafe(N * 2)
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const v = Math.sin(2 * Math.PI * freq * t) * vol
    const s = (Math.max(-1, Math.min(1, v)) * 0x7fff) | 0
    out.writeInt16LE(s, i * 2)
  }
  return out
}

/** One-call test. full=true validates the exact OpenAI WS output format path. */
export async function beepTest(
  voice: VoiceRuntime,
  opts: { full?: boolean; volume?: number; timeoutMs?: number } = {}
): Promise<boolean> {
  const { full = true, volume = 0.15, timeoutMs = 6000 } = opts

  // Quick Discord-only
  if (!full) {
    const beep = makeBeepPCM48kStereo(0.25, 440, 660, 0.45)
    const pb = voice.playPcm48Stereo(beep, { volume })
    return settleWithin(pb.done, timeoutMs)
  }

  // Full pipeline
  const bridge = createPcm24MonoToOpus48Stereo()
  try {
    await bridge.ready
  } catch (e) {
    console.warn('[beepTest] FFmpeg not ready:', (e as Error)?.message ?? e)
    safeClose(bridge)
    return false
  }

  const pb = voice.playOpus(bridge.opus, { volume })
  const pcm = makeBeepPCM24kMono(0.8, 660, 0.4)

  const r = Readable.from([
    pcm.subarray(0, Math.floor(pcm.length * 0.5)),
    pcm.subarray(Math.floor(pcm.length * 0.5)),
  ])
  r.on('data', (chunk: Buffer) => bridge.write(chunk))
  r.on('end', () => bridge.end())

  const ok = await settleWithin(pb.done, timeoutMs)
  safeClose(bridge)
  return ok
}

function settleWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    let done = false
    const t = setTimeout(() => {
      if (!done) {
        done = true
        resolve(false)
      }
    }, ms)
    p.then(
      () => {
        if (!done) {
          done = true
          clearTimeout(t)
          resolve(true)
        }
      },
      () => {
        if (!done) {
          done = true
          clearTimeout(t)
          resolve(false)
        }
      }
    )
  })
}

function safeClose(b: ReturnType<typeof createPcm24MonoToOpus48Stereo>) {
  try {
    b.end()
  } catch {}
  try {
    b.close()
  } catch {}
}
