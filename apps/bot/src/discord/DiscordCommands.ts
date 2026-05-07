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
    .setName("memory")
    .setDescription("Admin memory controls")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a memory")
        .addStringOption((option) =>
          option
            .setName("kind")
            .setDescription("Memory kind")
            .setRequired(true)
            .addChoices({ name: "semantic", value: "semantic" }, { name: "procedural", value: "procedural" }),
        )
        .addStringOption((option) => option.setName("text").setDescription("Memory text").setRequired(true))
        .addIntegerOption((option) => option.setName("importance").setDescription("Importance from 1 to 5").setMinValue(1).setMaxValue(5)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Search memory")
        .addStringOption((option) => option.setName("query").setDescription("Search query").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("recent")
        .setDescription("Show recent scoped memory")
        .addUserOption((option) => option.setName("user").setDescription("Limit to a user")),
    ),
  new SlashCommandBuilder()
    .setName("personality")
    .setDescription("Admin personality controls")
    .addSubcommand((subcommand) => subcommand.setName("get").setDescription("Show active personality"))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List personalities"))
    .addSubcommand((subcommand) => subcommand.setName("state").setDescription("Show durable character state"))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-state")
        .setDescription("Seed durable character state")
        .addStringOption((option) => option.setName("summary").setDescription("Character continuity summary"))
        .addStringOption((option) => option.setName("mood").setDescription("Current character mood"))
        .addStringOption((option) => option.setName("disposition").setDescription("Current character disposition")),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set active personality")
        .addStringOption((option) =>
          option
            .setName("profile")
            .setDescription("Personality profile")
            .setRequired(true)
            .addChoices(
              { name: "unhinged_gremlin", value: "unhinged_gremlin" },
              { name: "dry_menace", value: "dry_menace" },
              { name: "edgy_roaster", value: "edgy_roaster" },
              { name: "chaotic_character", value: "chaotic_character" },
            ),
        ),
    ),
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
