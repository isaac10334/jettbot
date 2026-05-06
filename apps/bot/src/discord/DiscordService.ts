import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
} from "discord.js";
import { createSignal, type Signal } from "@loop-kit/common/Signal";
import type { Env } from "../Env";
import { slashCommands } from "./DiscordCommands";

export interface DiscordService {
  readonly client: Client;
  readonly ready: Signal<void>;
  readonly messages: Signal<Message>;
  readonly interactions: Signal<ChatInputCommandInteraction>;
  readonly buttonInteractions: Signal<ButtonInteraction>;
  readonly login: () => Promise<void>;
  readonly registerSlashCommands: () => Promise<void>;
  readonly sendText: (channelId: string, content: string) => Promise<void>;
  readonly resolveMemberProfile: (guildId: string, userId: string) => Promise<{ readonly userId: string; readonly username?: string; readonly displayName?: string }>;
  readonly resolveMemberVoiceChannel: (guildId: string, userId: string) => Promise<string | undefined>;
  readonly destroy: () => void;
}

export const createDiscordService = (env: Env): DiscordService => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const ready = createSignal<void>();
  const messages = createSignal<Message>();
  const interactions = createSignal<ChatInputCommandInteraction>();
  const buttonInteractions = createSignal<ButtonInteraction>();

  client.once(Events.ClientReady, () => ready.emit());
  client.on(Events.MessageCreate, (message) => messages.emit(message));
  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) interactions.emit(interaction);
    if (interaction.isButton()) buttonInteractions.emit(interaction);
  });

  return {
    client,
    ready,
    messages,
    interactions,
    buttonInteractions,
    login: async () => {
      await client.login(env.DISCORD_BOT_TOKEN);
    },
    registerSlashCommands: async () => {
      const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
      if (env.DISCORD_GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID), { body: slashCommands });
      } else {
        await rest.put(Routes.applicationCommands(env.DISCORD_APPLICATION_ID), { body: slashCommands });
      }
    },
    sendText: async (channelId, content) => {
      const channel = await client.channels.fetch(channelId);
      if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.PublicThread || channel?.type === ChannelType.PrivateThread) {
        await channel.send(content);
      }
    },
    resolveMemberProfile: async (guildId, userId) => {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return {
        userId,
        username: member.user.username,
        displayName: member.displayName,
      };
    },
    resolveMemberVoiceChannel: async (guildId, userId) => {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return member.voice.channelId ?? undefined;
    },
    destroy: () => client.destroy(),
  };
};
