import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { createSignal, type Signal } from "@loop-kit/common/Signal";
import type { Env } from "../Env";

export interface DiscordService {
  readonly client: Client;
  readonly ready: Signal<void>;
  readonly messages: Signal<Message>;
  readonly interactions: Signal<ChatInputCommandInteraction>;
  readonly login: () => Promise<void>;
  readonly registerSlashCommands: () => Promise<void>;
  readonly sendText: (channelId: string, content: string) => Promise<void>;
  readonly resolveMemberVoiceChannel: (guildId: string, userId: string) => Promise<string | undefined>;
  readonly destroy: () => void;
}

const slashCommands = [
  new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the active voice channel"),
  new SlashCommandBuilder().setName("say").setDescription("Speak text in voice").addStringOption((option) => option.setName("text").setDescription("Text to speak").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Show bot status"),
  new SlashCommandBuilder().setName("memory-search").setDescription("Search bot memory").addStringOption((option) => option.setName("query").setDescription("Search query").setRequired(true)),
  new SlashCommandBuilder().setName("youtube").setDescription("Resolve YouTube audio").addStringOption((option) => option.setName("query").setDescription("URL or search query").setRequired(true)),
].map((command) => command.toJSON());

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

  client.once(Events.ClientReady, () => ready.emit());
  client.on(Events.MessageCreate, (message) => messages.emit(message));
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) interactions.emit(interaction);
  });

  return {
    client,
    ready,
    messages,
    interactions,
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
    resolveMemberVoiceChannel: async (guildId, userId) => {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return member.voice.channelId ?? undefined;
    },
    destroy: () => client.destroy(),
  };
};

