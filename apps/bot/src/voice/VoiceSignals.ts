export type VoiceState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting"; readonly guildId: string; readonly channelId: string }
  | { readonly status: "connected"; readonly guildId: string; readonly channelId: string; readonly sessionId: string }
  | { readonly status: "disconnecting"; readonly sessionId?: string }
  | { readonly status: "error"; readonly message: string };

