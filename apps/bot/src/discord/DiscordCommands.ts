import { SlashCommandBuilder } from "discord.js";

export const createSlashCommands = () => [
  new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the active voice channel"),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Speak text in voice")
    .addStringOption((option) => option.setName("text").setDescription("Text to speak").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Show bot status"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop active voice playback"),
  new SlashCommandBuilder()
    .setName("memory-search")
    .setDescription("Search bot memory")
    .addStringOption((option) => option.setName("query").setDescription("Search query").setRequired(true)),
  new SlashCommandBuilder()
    .setName("youtube")
    .setDescription("Play YouTube audio")
    .addStringOption((option) => option.setName("query").setDescription("URL or search query").setRequired(true)),
  new SlashCommandBuilder()
    .setName("img")
    .setDescription("Search for an image")
    .addStringOption((option) => option.setName("query").setDescription("Image search query").setRequired(true)),
];

export const slashCommands = createSlashCommands().map((command) => command.toJSON());
