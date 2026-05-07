import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction } from "discord.js";
import type { AppEnv } from "../app/AppRuntime";
import type { MemoryKind, MemoryItem, MemoryMessage } from "../memory/MemoryService";
import type { CharacterState } from "../personality/PersonalityService";
import type { YoutubeGuildPlaybackState } from "../youtube/YoutubePlaybackService";

const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const handledCommands = new Set(["join", "leave", "say", "status", "stop", "memory-search", "memory", "personality", "youtube"]);
const adminOnlyCommands = new Set(["memory-search", "memory", "personality"]);
const youtubeUiPrefix = "yt";

const youtubeCustomId = (action: "skip" | "stop") => `${youtubeUiPrefix}:${action}`;

const parseYoutubeCustomId = (value: string): "skip" | "stop" | undefined => {
  const [prefix, action] = value.split(":");
  if (prefix !== youtubeUiPrefix) return undefined;
  if (action === "skip" || action === "stop") return action;
  return undefined;
};

export const isAdminUser = (adminUserId: string | undefined, userId: string): boolean => adminUserId != null && adminUserId === userId;

const requireAdmin = async (runtime: { env: AppEnv }, interaction: { readonly user: { readonly id: string }; reply: (input: any) => Promise<unknown> }): Promise<boolean> => {
  if (isAdminUser(runtime.env.env.ADMIN_USER_ID, interaction.user.id)) return true;
  await interaction.reply({ content: "Admin-only command.", ...ephemeral });
  return false;
};

const renderMemoryItems = (rows: readonly MemoryItem[]): string =>
  rows.map((row) => `[${row.kind}] ${row.text}`).join("\n").slice(0, 1900) || "No results.";

const renderMessages = (rows: readonly MemoryMessage[]): string => rows.map((row) => row.text).join("\n").slice(0, 1900) || "No results.";

const renderCharacterState = (state: CharacterState): string =>
  [
    `Summary: ${state.summary}`,
    `Mood: ${state.mood}`,
    `Disposition: ${state.disposition}`,
    `Grudges: ${state.grudges.length > 0 ? state.grudges.join("; ") : "none"}`,
    `Attachments: ${state.attachments.length > 0 ? state.attachments.join("; ") : "none"}`,
  ].join("\n").slice(0, 1900);

const formatDuration = (seconds: number | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
};

const renderYoutubePlayback = (state: YoutubeGuildPlaybackState) => {
  const current = state.current;
  const queueLength = state.queue.length;
  const embed = new EmbedBuilder()
    .setColor(current?.status === "failed" ? 0xff5555 : 0x4f8cff)
    .setTitle(current ? "YouTube Playback" : "YouTube Queue")
    .setDescription(current?.media.title ?? "Nothing is playing.")
    .addFields(
      {
        name: "Status",
        value: current ? current.status : "idle",
        inline: true,
      },
      {
        name: "Queue",
        value: `${queueLength}`,
        inline: true,
      },
    );
  if (current?.media.webpageUrl ?? current?.media.url) {
    embed.setURL(current.media.webpageUrl ?? current.media.url);
  }
  if (current?.media.durationSeconds != null) {
    embed.addFields({ name: "Duration", value: formatDuration(current.media.durationSeconds), inline: true });
  }
  if (current?.error) {
    embed.addFields({ name: "Error", value: current.error.slice(0, 1_024) });
  } else if (state.lastError && !current) {
    embed.addFields({ name: "Last error", value: state.lastError.slice(0, 1_024) });
  }
  if (queueLength > 0) {
    const preview = state.queue.slice(0, 5).map((item, index) => `${index + 1}. ${item.media?.title ?? item.query}`).join("\n");
    embed.addFields({ name: "Up next", value: preview.slice(0, 1_024) });
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(youtubeCustomId("skip"))
      .setStyle(ButtonStyle.Primary)
      .setLabel("Skip")
      .setDisabled(!current),
    new ButtonBuilder()
      .setCustomId(youtubeCustomId("stop"))
      .setStyle(ButtonStyle.Danger)
      .setLabel("Stop All")
      .setDisabled(!current && queueLength === 0),
  );

  return {
    content: "",
    embeds: [embed],
    components: [row],
  };
};

const updateYoutubeUi = async (runtime: { env: AppEnv }) => {
  for (const guildState of Object.values(runtime.env.youtubePlayback.state.get().guilds)) {
    const uiMessage = guildState.uiMessage;
    const messageId = uiMessage?.messageId;
    const channelId = uiMessage?.channelId;
    if (!messageId || !channelId) continue;
    const channel = await runtime.env.discord.client.channels.fetch(channelId).catch(() => undefined);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(messageId).catch(() => undefined);
    if (!message) continue;
    await message.edit(renderYoutubePlayback(guildState)).catch(() => undefined);
  }
};

const upsertYoutubePlaybackMessage = async (runtime: { env: AppEnv }, guildId: string, channelId: string) => {
  const guildState = runtime.env.youtubePlayback.getGuildState(guildId);
  const rendered = renderYoutubePlayback(guildState);
  const uiMessage = guildState.uiMessage;
  if (uiMessage?.channelId === channelId) {
    const existingChannel = await runtime.env.discord.client.channels.fetch(channelId).catch(() => undefined);
    if (existingChannel?.isTextBased()) {
      const existing = await existingChannel.messages.fetch(uiMessage.messageId).catch(() => undefined);
      if (existing) return existing.edit(rendered);
    }
  }

  const channel = await runtime.env.discord.client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel) || typeof channel.send !== "function") {
    throw new Error("Cannot send YouTube playback UI in this channel.");
  }
  return channel.send(rendered);
};

export const installDiscordVoiceCommandPolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.discord.interactions.subscribe((interaction) => {
    if (!handledCommands.has(interaction.commandName)) return;
    void (async () => {
      const start = performance.now();
      let failed = false;
      runtime.env.metrics.increment(`discord.command.${interaction.commandName}.started`);
      try {
        if (adminOnlyCommands.has(interaction.commandName) && !(await requireAdmin(runtime, interaction))) return;
        if (!interaction.guildId) {
          await interaction.reply({ content: "Guild-only command.", ...ephemeral });
          return;
        }
        if (interaction.commandName === "join") {
          const channelId = await runtime.env.discord.resolveMemberVoiceChannel(interaction.guildId, interaction.user.id);
          if (!channelId) {
            await interaction.reply({ content: "Join a voice channel first.", ...ephemeral });
            return;
          }
          await interaction.deferReply(ephemeral);
          await runtime.env.voice.requestJoinVoice(interaction.guildId, channelId);
          await interaction.editReply("Joining voice.");
        }
        if (interaction.commandName === "leave") {
          await interaction.deferReply(ephemeral);
          await runtime.env.voice.requestLeaveVoice(interaction.guildId);
          await interaction.editReply("Leaving voice.");
        }
        if (interaction.commandName === "say") {
          const text = interaction.options.getString("text", true);
          runtime.env.signals.aiResponseComplete.emit({ text, guildId: interaction.guildId, channelId: interaction.channelId });
          await interaction.reply({ content: "Queued.", ...ephemeral });
        }
        if (interaction.commandName === "status") {
          await interaction.reply({ content: `Voice: ${runtime.env.voice.getGuildState(interaction.guildId).status}`, ...ephemeral });
        }
        if (interaction.commandName === "stop") {
          await interaction.deferReply(ephemeral);
          await runtime.env.youtubePlayback.cancelAll(interaction.guildId);
          await interaction.editReply("Stopped playback.");
        }
        if (interaction.commandName === "memory-search") {
          const query = interaction.options.getString("query", true);
          const rows = await runtime.env.memory.search(query, { limit: 5, guildId: interaction.guildId });
          await interaction.reply({ content: renderMessages(rows), ...ephemeral });
        }
        if (interaction.commandName === "memory") {
          const subcommand = interaction.options.getSubcommand(true);
          if (subcommand === "add") {
            const kind = interaction.options.getString("kind", true) as MemoryKind;
            const text = interaction.options.getString("text", true);
            const importance = interaction.options.getInteger("importance") ?? 3;
            const item = await runtime.env.memory.addMemory({
              kind,
              guildId: interaction.guildId,
              channelId: interaction.channelId,
              userId: interaction.user.id,
              text,
              importance,
            });
            await interaction.reply({ content: `Added ${item.kind} memory: ${item.text}`, ...ephemeral });
          }
          if (subcommand === "search") {
            const query = interaction.options.getString("query", true);
            const rows = await runtime.env.memory.searchMemoryItems(query, { limit: 8, guildId: interaction.guildId });
            await interaction.reply({ content: renderMemoryItems(rows), ...ephemeral });
          }
          if (subcommand === "recent") {
            const user = interaction.options.getUser("user");
            const rows = await runtime.env.memory.recentMemoryItems({
              limit: 8,
              guildId: interaction.guildId,
              ...(user ? { userId: user.id } : {}),
            });
            await interaction.reply({ content: renderMemoryItems(rows), ...ephemeral });
          }
        }
        if (interaction.commandName === "personality") {
          const subcommand = interaction.options.getSubcommand(true);
          if (subcommand === "get") {
            const profile = await runtime.env.personality.getActiveProfile({ guildId: interaction.guildId });
            await interaction.reply({ content: `${profile.name}: ${profile.summary}`, ...ephemeral });
          }
          if (subcommand === "list") {
            await interaction.reply({
              content: runtime.env.personality.listProfiles().map((profile) => `${profile.id}: ${profile.summary}`).join("\n"),
              ...ephemeral,
            });
          }
          if (subcommand === "state") {
            const state = await runtime.env.personality.getCharacterState({ guildId: interaction.guildId });
            await interaction.reply({ content: renderCharacterState(state), ...ephemeral });
          }
          if (subcommand === "set-state") {
            const summary = interaction.options.getString("summary")?.trim();
            const mood = interaction.options.getString("mood")?.trim();
            const disposition = interaction.options.getString("disposition")?.trim();
            if (!summary && !mood && !disposition) throw new Error("Set at least one character state field.");
            const state = await runtime.env.personality.setCharacterState(
              {
                ...(summary ? { summary } : {}),
                ...(mood ? { mood } : {}),
                ...(disposition ? { disposition } : {}),
              },
              { guildId: interaction.guildId },
            );
            await interaction.reply({ content: renderCharacterState(state), ...ephemeral });
          }
          if (subcommand === "set") {
            const profileId = interaction.options.getString("profile", true);
            if (!runtime.env.personality.isProfileId(profileId)) throw new Error("Unknown personality profile.");
            await runtime.env.personality.setActiveProfile(profileId, { guildId: interaction.guildId });
            const profile = await runtime.env.personality.getActiveProfile({ guildId: interaction.guildId });
            await interaction.reply({ content: `Personality set to ${profile.name}.`, ...ephemeral });
          }
        }
        if (interaction.commandName === "youtube") {
          const query = interaction.options.getString("query", true);
          const voiceState = runtime.env.voice.getGuildState(interaction.guildId);
          if (voiceState.status !== "connected") {
            const channelId = await runtime.env.discord.resolveMemberVoiceChannel(interaction.guildId, interaction.user.id);
            if (!channelId) {
              await interaction.reply({ content: "Join a voice channel first.", ...ephemeral });
              return;
            }
            await interaction.deferReply(ephemeral);
            await runtime.env.voice.requestJoinVoice(interaction.guildId, channelId);
          } else {
            await interaction.deferReply(ephemeral);
          }
          const result = await runtime.env.youtubePlayback.enqueue({
            guildId: interaction.guildId,
            query,
            requestedByUserId: interaction.user.id,
            ...(interaction.channelId ? { requestedInChannelId: interaction.channelId } : {}),
          });
          const reply = await upsertYoutubePlaybackMessage(runtime, interaction.guildId, interaction.channelId);
          const youtubeState = runtime.env.youtubePlayback.state.get();
          const guildState = runtime.env.youtubePlayback.getGuildState(interaction.guildId);
          runtime.env.youtubePlayback.state.set({
            ...youtubeState,
            guilds: {
              ...youtubeState.guilds,
              [interaction.guildId]: {
                ...guildState,
                uiMessage: {
                  channelId: interaction.channelId,
                  messageId: reply.id,
                },
              },
            },
          });
          await interaction.editReply("Queued in the playback UI.");
          const title = result.item.media?.title ?? query;
          runtime.env.console.info("youtube.command.enqueued", { title, position: result.position });
        }
      } catch (error) {
        failed = true;
        runtime.env.metrics.increment(`discord.command.${interaction.commandName}.failed`);
        throw error;
      } finally {
        if (!failed) runtime.env.metrics.increment(`discord.command.${interaction.commandName}.completed`);
        runtime.env.metrics.recordTiming(`discord.command.${interaction.commandName}.duration_ms`, performance.now() - start);
      }
    })().catch(async (error) => {
      const content = error instanceof Error ? error.message : String(error);
      runtime.env.console.error("discord.command.failed", { commandName: interaction.commandName, error });
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => undefined);
      else await interaction.reply({ content, ...ephemeral }).catch(() => undefined);
    });
  });

  const unsubscribeButtons = runtime.env.discord.buttonInteractions.subscribe((interaction) => {
    void handleYoutubeButton(runtime, interaction).catch(async (error) => {
      const content = error instanceof Error ? error.message : String(error);
      runtime.env.console.error("discord.youtube.button.failed", { customId: interaction.customId, error });
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => undefined);
      else await interaction.reply({ content, ...ephemeral }).catch(() => undefined);
    });
  });

  const unsubscribeYoutube = runtime.env.youtubePlayback.changed.subscribe(() => {
    void updateYoutubeUi(runtime).catch((error) => {
      runtime.env.console.warn("discord.youtube.ui.update_failed", { error });
    });
  });

  return installedVoid(() => {
    unsubscribe();
    unsubscribeButtons();
    unsubscribeYoutube();
  });
};

const handleYoutubeButton = async (runtime: { env: AppEnv }, interaction: ButtonInteraction) => {
  const action = parseYoutubeCustomId(interaction.customId);
  if (!action) return;
  if (!interaction.guildId) return;
  await interaction.deferUpdate();
  if (action === "skip") await runtime.env.youtubePlayback.skip(interaction.guildId);
  if (action === "stop") await runtime.env.youtubePlayback.cancelAll(interaction.guildId);
  await interaction.editReply(renderYoutubePlayback(runtime.env.youtubePlayback.getGuildState(interaction.guildId))).catch(() => undefined);
};

export const __discordVoiceCommandPolicyTestUtils = {
  parseYoutubeCustomId,
  handleYoutubeButton,
  isAdminUser,
};
