import { Readable } from 'stream'
import {
  AudioPlayer,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  StreamType,
  VoiceConnection,
} from '@discordjs/voice'
import type { RealtimeSession, TransportLayerAudio } from '@openai/agents/realtime'
import prism from 'prism-media'

// export function pipeAIToDiscord(connection: VoiceConnection, session: RealtimeSession) {
//   const player = createAudioPlayer()
//   connection.subscribe(player)

//   session.on('audio', (event: { data: ArrayBuffer | string }) => {
//     // decode base64 if needed
//     const buf =
//       typeof event.data === 'string'
//         ? Buffer.from(event.data, 'base64')
//         : Buffer.from(new Uint8Array(event.data))

//     // turn the buffer into a readable stream for Discord’s player
//     const stream = Readable.from([buf])

//     // If it’s PCM16 (most likely), encode to Opus before playback
//     const encoder = new prism.opus.Encoder({ rate: 24000, channels: 1, frameSize: 960 })
//     const opusStream = stream.pipe(encoder)

//     const resource = createAudioResource(opusStream, { inputType: StreamType.Opus })
//     player.play(resource)
//   })

//   return () => player.stop()
// }

export function pipeDiscordToAI(connection: VoiceConnection, session: any, userId: string) {
  // 1) Discord Opus RTP
  const opusRtp = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
  })

  // 2) Opus -> PCM s16le 48k stereo (requires @discordjs/opus native)
  const opusDec = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })

  // 3) PCM 48k stereo -> PCM 24k mono s16le
  const to24kMono = new prism.FFmpeg({
    args: [
      // input: raw PCM
      '-f',
      's16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-i',
      'pipe:0',
      '-fflags',
      '+bitexact',
      // output: raw PCM16 @ 24k mono
      '-f',
      's16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      'pipe:1',
    ],
  })

  // Wire
  opusRtp.pipe(opusDec).pipe(to24kMono)

  let closed = false
  const closeAll = () => {
    if (closed) return
    closed = true
    try {
      to24kMono.removeAllListeners()
      to24kMono.destroy()
    } catch {}
    try {
      opusDec.removeAllListeners()
      opusDec.destroy()
    } catch {}
    try {
      opusRtp.removeAllListeners()
      opusRtp.destroy()
    } catch {}
  }

  // If your TS types say ArrayBuffer, but the server *actually* wants base64,
  // just cast to `any` and send base64 — this matches the server error you’re seeing.
  to24kMono.on('data', (buf: Buffer) => {
    // sanity: s16le mono => even length
    if ((buf.length & 1) !== 0) return
    const b64 = buf.toString('base64')
    const ok = (session as any).sendAudio(b64) // <-- base64 string
    if (ok === false && typeof session.once === 'function') {
      to24kMono.pause()
      session.once('drain', () => to24kMono.resume())
    }
  })

  // Stop writing if WS errors/closes to avoid EPIPE
  const stopOnSessionEnd = () => closeAll()
  // Attach whichever events your session exposes:
  session.on?.('error', stopOnSessionEnd)
  session.on?.('close', stopOnSessionEnd)
  session.on?.('disconnect', stopOnSessionEnd)

  // If the server VAD is on (your log shows createResponse:true), you do NOT need to commit manually.
  // If you later disable VAD, add a commit on end:
  to24kMono.once('end', () => {
    /* session.sendEvent({ type:'input_audio_buffer.commit' }) */
  })
  to24kMono.once('close', closeAll)

  // Helpful debugging
  opusRtp.once('data', b => console.log(`[${userId}] first Opus RTP ${b.length}B`))
  to24kMono.once('data', b => console.log(`[${userId}] first PCM24k ${b.length}B`))
  to24kMono.on('error', e => {
    console.warn('ffmpeg error', e)
    closeAll()
  })
  opusDec.on('error', e => {
    console.warn('opus decoder error', e)
    closeAll()
  })
  opusRtp.on('error', e => {
    console.warn('opus RTP error', e)
    closeAll()
  })
}

type RTChunk = ArrayBuffer | string // base64 or binary depending on your SDK

export function pipeAIToDiscord(connection: VoiceConnection, session: any) {
  const player: AudioPlayer = createAudioPlayer()
  connection.subscribe(player)

  let ff: prism.FFmpeg | null = null
  let enc: prism.opus.Encoder | null = null
  let started = false
  let closed = false

  const start = () => {
    ff = new prism.FFmpeg({
      args: [
        // input: PCM16 mono @ 24k from Realtime
        '-f',
        's16le',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-fflags',
        '+bitexact',
        // output: PCM16 stereo @ 48k for Opus
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1',
      ],
    })
    enc = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 })

    const opusOut = ff.pipe(enc)
    const resource = createAudioResource(opusOut, { inputType: StreamType.Opus })
    player.play(resource)

    // minimal cleanup
    const bail = () => {
      if (!closed) {
        closed = true
        try {
          ;(ff as any).stdin?.end()
        } catch {}
        try {
          ff?.destroy()
        } catch {}
        try {
          enc?.destroy()
        } catch {}
      }
    }
    ff.on('error', bail)
    enc.on('error', bail)
    opusOut.on('end', bail)
    opusOut.on('close', bail)

    started = true
  }

  const writePCM = (buf: Buffer) => {
    if (closed) return
    if (!started) start()
    if (buf.length & 1) buf = buf.subarray(0, buf.length - 1) // PCM16 must be even length
    const ok = (ff as any).stdin.write(buf)
    if (!ok) (ff as any).stdin.once('drain', () => {})
  }

  // Realtime → PCM chunk(s)
  session.on('audio', (chunk: RTChunk) => {
    const buf =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'base64')
        : Buffer.from(new Uint8Array(chunk as ArrayBuffer))
    writePCM(buf)
  })

  // End-of-response (adjust to your SDK’s event names)
  const end = () => {
    if (!closed) {
      closed = true
      try {
        ;(ff as any)?.stdin?.end()
      } catch {}
    }
  }
  session.on?.('response.completed', end)
  session.on?.('audio.done', end)
  session.on?.('close', end)
  session.on?.('error', end)

  return () => {
    end()
  }
}
