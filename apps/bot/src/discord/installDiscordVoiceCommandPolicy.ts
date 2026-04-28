import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import { MessageFlags } from "discord.js";
import type { AppEnv } from "../app/AppRuntime";

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

export const installDiscordVoiceCommandPolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.discord.interactions.subscribe((interaction) => {
    void (async () => {
      const start = performance.now();
      let failed = false;
      runtime.env.metrics.increment(`discord.command.${interaction.commandName}.started`);
      try {
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
          await runtime.env.voice.requestLeaveVoice();
          await interaction.editReply("Leaving voice.");
        }
        if (interaction.commandName === "say") {
          const text = interaction.options.getString("text", true);
          runtime.env.signals.aiResponseComplete.emit(text);
          await interaction.reply({ content: "Queued.", ...ephemeral });
        }
        if (interaction.commandName === "status") {
          await interaction.reply({ content: `Voice: ${runtime.env.voice.state.get().status}`, ...ephemeral });
        }
        if (interaction.commandName === "memory-search") {
          const query = interaction.options.getString("query", true);
          const rows = await runtime.env.memory.search(query, { limit: 5 });
          await interaction.reply({ content: rows.map((row) => row.text).join("\n") || "No results.", ...ephemeral });
        }
        if (interaction.commandName === "youtube") {
          const query = interaction.options.getString("query", true);
          const result = await runtime.env.tools.callTool("youtube_audio", { query });
          await interaction.reply({ content: JSON.stringify(result), ...ephemeral });
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
  return installedVoid(unsubscribe);
};
