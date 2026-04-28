import type { ChatInputCommandInteraction, Client, Message } from "discord.js";

export interface DiscordEvents {
  readonly client: Client;
  readonly messageCreate: Message;
  readonly interactionCreate: ChatInputCommandInteraction;
}

