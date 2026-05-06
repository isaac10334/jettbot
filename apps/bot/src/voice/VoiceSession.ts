export interface VoiceSession {
  readonly guildId: string;
  readonly channelId: string;
  readonly sessionId: string;
  readonly startedAt: Date;
}

