import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Message } from "discord.js";
import type { Console } from "@loop-kit/common/Console";
import { installedVoid, type Installer, type Runtime } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";
import type { MetricsService } from "../observability/MetricsService";
import { defaultImageSafeSearch, type ImageSearchResult } from "./ImageSearchService";
import type { ImageSearchSession } from "./ImageSearchSessionService";

const commandName = "img";
const customPrefix = "img";
const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const minimumOriginalWidth = 700;
const minimumOriginalHeight = 350;

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

const shouldUseOriginalImage = (result: ImageSearchResult): boolean => {
  if (result.width == null || result.height == null) return false;
  return result.width >= minimumOriginalWidth && result.height >= minimumOriginalHeight;
};

const selectEmbedImageUrl = (result: ImageSearchResult): { readonly url: string; readonly source: "original" | "thumbnail" } => {
  if (shouldUseOriginalImage(result)) return { url: result.imageUrl, source: "original" };
  if (result.thumbnailUrl) return { url: result.thumbnailUrl, source: "thumbnail" };
  return { url: result.imageUrl, source: "original" };
};

const recordImageSelection = (metrics: MetricsService | undefined, result: ImageSearchResult, source: "original" | "thumbnail") => {
  metrics?.increment(`image.render.${source}`);
  if (result.width != null) metrics?.recordTiming("image.render.original_width_px", result.width);
  if (result.height != null) metrics?.recordTiming("image.render.original_height_px", result.height);
  if (result.thumbnailWidth != null) metrics?.recordTiming("image.render.thumbnail_width_px", result.thumbnailWidth);
  if (result.thumbnailHeight != null) metrics?.recordTiming("image.render.thumbnail_height_px", result.thumbnailHeight);
};

const logImageSelection = (console: Console | undefined, session: ImageSearchSession, result: ImageSearchResult, image: { readonly url: string; readonly source: "original" | "thumbnail" }) => {
  console?.info("image.render.selection", {
    sessionId: session.id,
    query: session.query,
    index: session.index,
    resultCount: session.results.length,
    selectedSource: image.source,
    selectedUrl: image.url,
    title: result.title,
    pageUrl: result.pageUrl,
    imageUrl: result.imageUrl,
    thumbnailUrl: result.thumbnailUrl,
    source: result.source,
    width: result.width,
    height: result.height,
    thumbnailWidth: result.thumbnailWidth,
    thumbnailHeight: result.thumbnailHeight,
  });
};

const renderSession = (session: ImageSearchSession, metrics?: MetricsService, console?: Console) => {
  const result = session.results[session.index];
  if (!result) return { content: "No image results.", embeds: [], components: [] };
  const image = selectEmbedImageUrl(result);
  recordImageSelection(metrics, result, image.source);
  logImageSelection(console, session, result, image);

  const embed = new EmbedBuilder()
    .setTitle(result.title.slice(0, 256))
    .setURL(result.pageUrl)
    .setImage(image.url)
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
    runtime.env.console.info("image.search.completed", {
      query: response.query,
      resultCount: response.results.length,
      requestedCount: runtime.env.env.JETTBOT_IMAGE_SEARCH_COUNT,
      safeSearch: defaultImageSafeSearch,
    });
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
  await message.reply(renderSession(session, runtime.env.metrics, runtime.env.console));
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
  await interaction.editReply(renderSession(session, runtime.env.metrics, runtime.env.console));
};

const handleButton = async (runtime: Runtime<AppEnv>, interaction: ButtonInteraction) => {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;

  const existing = runtime.env.imageSearchSessions.get(parsed.sessionId);
  if (!existing) {
    await interaction.deferUpdate().catch(() => undefined);
    return;
  }
  if (existing.ownerUserId !== interaction.user.id) {
    await interaction.reply({ content: "Only the user who started this image search can page it.", ...ephemeral });
    return;
  }

  const session = runtime.env.imageSearchSessions.move(parsed.sessionId, parsed.direction);
  if (!session) {
    await interaction.deferUpdate().catch(() => undefined);
    return;
  }
  await interaction.update(renderSession(session, runtime.env.metrics, runtime.env.console));
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

export const __discordImagePolicyTestUtils = {
  handleButton,
  handleCommand,
  handleMessage,
  parseCustomId,
  renderSession,
  selectEmbedImageUrl,
};
