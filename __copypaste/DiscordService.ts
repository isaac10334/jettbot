import { Client, Events, VoiceState, GuildMember } from "discord.js"
import type { Interaction, ClientEvents } from "discord.js"
import { joinVoiceChannel, VoiceConnection, AudioPlayer, AudioResource } from "@discordjs/voice"
import { Brand, Context, Effect, Ref, Stream } from "effect"

export type GuildId = string & Brand.Brand<"GuildId">;
export const GuildId = Brand.nominal<GuildId>();

export type ChannelId = string & Brand.Brand<"ChannelId">;
export const ChannelId = Brand.nominal<ChannelId>();

export type VoiceChannelId = string & Brand.Brand<"VoiceChannelId">;
export const VoiceChannelId = Brand.nominal<VoiceChannelId>();

export type UserId = string & Brand.Brand<"UserId">;
export const UserId = Brand.nominal<UserId>();

export type MessageId = string & Brand.Brand<"MessageId">;
export const MessageId = Brand.nominal<MessageId>();

export interface Message {
  readonly id: MessageId
  readonly channelId: ChannelId
  readonly guildId?: GuildId
  readonly authorId: UserId
  readonly content: string
  readonly createdAt: Date
}
export interface Channel {
  readonly channelId: ChannelId
  readonly guildId?: GuildId
}
export interface SendText {
  channelId: ChannelId
  content: string
  replyTo?: MessageId
}
export interface VoiceChannelEvent {
  
}
export interface VoiceJoin {
  guildId: GuildId
  channelId: ChannelId
  userId: UserId
}
export interface VoiceLeave {
  guildId: GuildId
  channelId: ChannelId
  userId: UserId
}

export interface DiscordServiceShape {
  client: Ref.Ref<Client>
  sendText(msg: SendText): Effect.Effect<void>
  editMessage(channel: ChannelId, messageId: MessageId, content: string): Effect.Effect<void>
  deleteMessage(channel: ChannelId, messageId: MessageId): Effect.Effect<void>
  fetchMessage(channel: ChannelId, messageId: MessageId): Effect.Effect<Message>
  fetchChannel(channel: ChannelId | VoiceChannelId): Effect.Effect<Channel>
  fetchUserName(userId: UserId): Effect.Effect<string>
  joinVoiceChannel(channelId: string): Stream.Stream<VoiceChannelEvent, never, never>
  messages: Stream.Stream<Message>
  voiceJoins: Stream.Stream<VoiceJoin>
  voiceLeaves: Stream.Stream<VoiceLeave>
  errors: Stream.Stream<Error>
  interactions: Stream.Stream<Interaction>
  interactionCommands: Stream.Stream<Interaction>
  getUserVoiceChannel(userId: UserId, guildId: GuildId): Effect.Effect<ChannelId | undefined>
  shutdown: Effect.Effect<void>
}

export class Discord extends Context.Tag("DiscordService")<
  Discord,
  DiscordServiceShape
>() {}