import type { Client, Guild, GuildBasedChannel } from 'discord.js'
import { ChannelType, PermissionFlagsBits } from 'discord.js'
import prism from 'prism-media'

// Simple structure so you can render/act on it.
export type SanityReport = {
  ok: boolean
  issues: { level: 'error' | 'warn'; code: string; detail: string }[]
}

export async function sanityCheckVoice(
  client: Client,
  guild: Guild,
  channel: GuildBasedChannel | null
): Promise<SanityReport> {
  const issues: SanityReport['issues'] = []

  if (!client.isReady())
    issues.push({
      level: 'error',
      code: 'client_not_ready',
      detail: 'Discord client is not ready yet.',
    })

  // Intents: we can’t change at runtime, but we can flag missing ones
  const intents = (client.options as any).intents?.bitfield ?? 0
  const needs = ['Guilds', 'GuildVoiceStates']
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GatewayIntentBits } = require('discord.js')
  for (const need of needs) {
    const bit = GatewayIntentBits[need]
    if ((intents & bit) === 0)
      issues.push({ level: 'warn', code: 'intent_missing', detail: `Missing intent: ${need}` })
  }

  if (!channel)
    issues.push({
      level: 'error',
      code: 'channel_missing',
      detail: 'Target voice channel not found.',
    })
  else {
    if (channel.type === ChannelType.GuildStageVoice)
      issues.push({
        level: 'warn',
        code: 'stage_channel',
        detail: 'Channel is a Stage; bots may be suppressed until invited to speak.',
      })
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
      issues.push({
        level: 'error',
        code: 'wrong_channel_type',
        detail: 'Channel is not a voice/stage channel.',
      })

    const me = channel.guild.members.me
    if (!me)
      issues.push({
        level: 'error',
        code: 'bot_member_missing',
        detail: 'Bot member not present in guild context.',
      })
    else {
      const perms = channel.permissionsFor(me)
      if (!perms)
        issues.push({
          level: 'error',
          code: 'perms_unknown',
          detail: 'Could not resolve channel permissions for bot.',
        })
      else {
        if (!perms.has(PermissionFlagsBits.Connect))
          issues.push({
            level: 'error',
            code: 'perm_connect',
            detail: 'Bot lacks CONNECT in this channel.',
          })
        if (!perms.has(PermissionFlagsBits.Speak))
          issues.push({
            level: 'error',
            code: 'perm_speak',
            detail: 'Bot lacks SPEAK in this channel.',
          })
        if (me.voice?.serverMute)
          issues.push({ level: 'warn', code: 'server_muted', detail: 'Bot is server-muted.' })
      }
    }
  }

  // Opus sanity: try constructing encoder (fast noop)
  try {
    const enc = new prism.opus.Encoder({ rate: 48_000, channels: 2, frameSize: 960 })
    enc.destroy()
  } catch (e: any) {
    issues.push({
      level: 'error',
      code: 'opus_failed',
      detail: `Opus encoder unavailable: ${e?.message ?? e}`,
    })
  }

  // We cannot read **user volume slider** via API → instruct manual check
  // But we add a friendly reminder
  issues.push({
    level: 'warn',
    code: 'user_volume',
    detail:
      'Discord client User Volume for the bot is not readable via API. Manually check it is > 0%.',
  })

  return { ok: issues.every(i => i.level !== 'error'), issues }
}
