export type VoiceGuildState =
  | { readonly status: "disconnected"; readonly guildId: string }
  | { readonly status: "connecting"; readonly guildId: string; readonly channelId: string }
  | { readonly status: "connected"; readonly guildId: string; readonly channelId: string; readonly sessionId: string }
  | { readonly status: "disconnecting"; readonly guildId: string; readonly sessionId?: string }
  | { readonly status: "error"; readonly guildId: string; readonly message: string };

export interface VoiceState {
  readonly sessions: Readonly<Record<string, VoiceGuildState>>;
}
