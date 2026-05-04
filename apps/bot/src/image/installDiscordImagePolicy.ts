import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Message } from "discord.js";
import { installedVoid, type Installer, type Runtime } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";
import { defaultImageSafeSearch } from "./ImageSearchService";
import type { ImageSearchSession } from "./ImageSearchSessionService";

const commandName = "img";
const customPrefix = "img";
const ephemeral = { flags: MessageFlags.Ephemeral } as const;

const parseMessageQuery = (message: Message): string | undefined => {
  const match = /^\.img(?:\s+(.+))?$/i.exec(message.content.trim());
  return match?.[1]?.trim() || undefined;
};

const customId = (direction: "prev" | "next", sessionId: string) => `${customPrefix}:${direction}:${sessionId}`;

const parseCustomId = (value: string): { readonly direction: "prev" | "next"; readonly sessionId: string } | undefined => {
  const [prefix, direction, sessionId] = value.split(":");
  if (prefix !== customPrefix) return undefined;
  if (direction !== "prev" && direction !== "next") return undefined;
  if (!sessionId) return undefined;
  return { direction, sessionId };
};

const renderSession = (session: ImageSearchSession) => {
  const result = session.results[session.index];
  if (!result) return { content: "No image results.", embeds: [], components: [] };

  const embed = new EmbedBuilder()
    .setTitle(result.title.slice(0, 256))
    .setURL(result.pageUrl)
    .setImage(result.thumbnailUrl ?? result.imageUrl)
    .setFooter({ text: `Image ${session.index + 1}/${session.results.length}${result.source ? ` - ${result.source}` : ""}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("prev", session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Previous")
      .setDisabled(session.index <= 0),
    new ButtonBuilder()
      .setCustomId(customId("next", session.id))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Next")
      .setDisabled(session.index >= session.results.length - 1),
  );

  return {
    content: `Image search: ${session.query}`,
    embeds: [embed],
    components: [row],
  };
};

const retryText = (retryAfterMs: number | undefined) => {
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 1_000) / 1_000));
  return `Slow down. Try again in ${seconds}s.`;
};

const runSearch = async (runtime: Runtime<AppEnv>, input: {
  readonly query: string;
  readonly userId: string;
  readonly rateLimitKey: string;
}) => {
  const limit = runtime.env.imageRateLimits.consume(input.rateLimitKey);
  if (!limit.allowed) throw new Error(retryText(limit.retryAfterMs));

  const start = performance.now();
  runtime.env.metrics.increment("image.search.started");
  try {
    const response = await runtime.env.imageSearch.search({ query: input.query, count: runtime.env.env.JETTBOT_IMAGE_SEARCH_COUNT, safeSearch: defaultImageSafeSearch });
    if (response.results.length === 0) throw new Error(`No image results for "${input.query}".`);
    runtime.env.metrics.increment("image.search.completed");
    runtime.env.metrics.recordTiming("image.search.duration_ms", performance.now() - start);
    return runtime.env.imageSearchSessions.create({ ownerUserId: input.userId, response });
  } catch (error) {
    runtime.env.metrics.increment("image.search.failed");
    runtime.env.metrics.recordTiming("image.search.duration_ms", performance.now() - start);
    throw error;
  }
};

const handleMessage = async (runtime: Runtime<AppEnv>, message: Message) => {
  if (message.author.bot || !message.guildId) return;
  const query = parseMessageQuery(message);
  if (!query) {
    if (/^\.img\s*$/i.test(message.content.trim())) await message.reply("Usage: `.img search terms`");
    return;
  }
  const session = await runSearch(runtime, {
    query,
    userId: message.author.id,
    rateLimitKey: `message:${message.guildId}:${message.author.id}`,
  });
  await message.reply(renderSession(session));
};

const handleCommand = async (runtime: Runtime<AppEnv>, interaction: ChatInputCommandInteraction) => {
  if (interaction.commandName !== commandName) return;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Guild-only command.", ...ephemeral });
    return;
  }

  await interaction.deferReply();
  const query = interaction.options.getString("query", true);
  const session = await runSearch(runtime, {
    query,
    userId: interaction.user.id,
    rateLimitKey: `command:${interaction.guildId}:${interaction.user.id}`,
  });
  await interaction.editReply(renderSession(session));
};

const handleButton = async (runtime: Runtime<AppEnv>, interaction: ButtonInteraction) => {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;

  const existing = runtime.env.imageSearchSessions.get(parsed.sessionId);
  if (!existing) {
    await interaction.reply({ content: "That image search expired. Run `.img` or `/img` again.", ...ephemeral });
    return;
  }
  if (existing.ownerUserId !== interaction.user.id) {
    await interaction.reply({ content: "Only the user who started this image search can page it.", ...ephemeral });
    return;
  }

  const session = runtime.env.imageSearchSessions.move(parsed.sessionId, parsed.direction);
  if (!session) {
    await interaction.reply({ content: "That image search expired. Run `.img` or `/img` again.", ...ephemeral });
    return;
  }
  await interaction.update(renderSession(session));
};

export const installDiscordImagePolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribeMessages = runtime.env.discord.messages.subscribe((message) => {
    void handleMessage(runtime, message).catch((error) => {
      runtime.env.console.error("discord.image.message.failed", { error });
      void message.reply(error instanceof Error ? error.message : String(error)).catch(() => undefined);
    });
  });

  const unsubscribeCommands = runtime.env.discord.interactions.subscribe((interaction) => {
    void handleCommand(runtime, interaction).catch(async (error) => {
      const content = error instanceof Error ? error.message : String(error);
      runtime.env.console.error("discord.image.command.failed", { commandName: interaction.commandName, error });
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => undefined);
      else await interaction.reply({ content, ...ephemeral }).catch(() => undefined);
    });
  });

  const unsubscribeButtons = runtime.env.discord.buttonInteractions.subscribe((interaction) => {
    void handleButton(runtime, interaction).catch(async (error) => {
      const content = error instanceof Error ? error.message : String(error);
      runtime.env.console.error("discord.image.button.failed", { customId: interaction.customId, error });
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => undefined);
      else await interaction.reply({ content, ...ephemeral }).catch(() => undefined);
    });
  });

  return installedVoid(() => {
    unsubscribeMessages();
    unsubscribeCommands();
    unsubscribeButtons();
  });
};
