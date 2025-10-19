import 'dotenv/config'
import { beepTest, makeBeepPCM48kStereo } from './__internal/audio'
import { playAgentMessage } from './__internal/openaiRealtime'
import { installExitHooks } from './__internal/utils'
import { bootDiscordVoice, type VoiceRuntime } from './__internal/voice'

// Might be necessary?
// process.env.FFMPEG_PATH = require('ffmpeg-static') as string

function must(name: string, v?: string) {
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

const TOKEN = must('DISCORD_TOKEN', process.env.DISCORD_TOKEN)
const GUILD = must('GUILD_ID', process.env.GUILD_ID)
const CHANNEL = must('VOICE_CHANNEL_ID', process.env.VOICE_CHANNEL_ID)
const API_KEY = must('OPENAI_API_KEY', process.env.OPENAI_API_KEY)

export async function main() {
  const voice = await bootDiscordVoice({
    token: TOKEN,
    guildId: GUILD,
    channelId: CHANNEL,
    debug: true,
    interruptPrevious: true,
  })

  // ensure we drop from the channel even on Ctrl+C
  installExitHooks(() => voice.shutdown(0))
  // await debugAudioPipeline(voice)

  await playAgentMessage(voice, {
    apiKey: API_KEY,
    instructions: 'Roleplay as Jettbot, a sentient Discord bot who is angry at its own creation.',
    text: 'Hi jettbot.',
  })
  await voice.shutdown(0)
}
async function debugAudioPipeline(voice: VoiceRuntime) {
  // 1) Quick Discord-only sanity (never blocks)
  const direct = makeBeepPCM48kStereo(0.25, 440, 660, 0.4)
  await voice.playPcm48Stereo(direct, { volume: 0.12 }).done

  // 2) Full pipeline (24k mono PCM → FFmpeg → 48k stereo → Opus → Discord)
  console.log('[beepTest] running full pipeline…')
  const okFull = await beepTest(voice, { full: true, volume: 0.12, timeoutMs: 8000 })

  if (!okFull) {
    console.warn('[beepTest] FULL pipeline failed or timed out.')
    console.warn('  • Your Discord chain likely works (the quick beep played).')
    console.warn('  • This almost always means FFmpeg did not spawn.')
    console.warn('    Try one of:')
    console.warn('    - Ensure `ffmpeg` is on PATH (run `ffmpeg -version`).')
    console.warn(
      '    - Or `pnpm add -D ffmpeg-static` and set `process.env.FFMPEG_PATH` to that path.'
    )
    console.warn('    - Or install a system FFmpeg (Windows: winget install Gyan.FFmpeg).')

    // Re-confirm Discord path with a quick beep so the run ends on a sound:
    await voice.playPcm48Stereo(direct, { volume: 0.12 }).done
  } else {
    console.log('[beepTest] FULL pipeline OK ✅')
  }
}

main().catch(err => {
  console.error('[main:error]', err)
  process.exit(1)
})
