import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installDiscordMessagePolicy: Installer<AppEnv> = (runtime) => {
  const unsubscribe = runtime.env.discord.messages.subscribe((message) => {
    if (message.author.bot || !message.guildId) return;
    const messageGuildId = message.guildId;
    const content = message.content.trim();
    void (async () => {
      if (/^jett\s+join$/i.test(content)) {
        const guildId = message.guildId;
        if (!guildId) return;
        const channelId = await runtime.env.discord.resolveMemberVoiceChannel(guildId, message.author.id);
        if (!channelId) {
          await message.reply("Join a voice channel first.");
          return;
        }
        await runtime.env.voice.requestJoinVoice(guildId, channelId);
        await message.reply("Joining voice.");
      } else if (/^jett\s+leave$/i.test(content)) {
        await runtime.env.voice.requestLeaveVoice(messageGuildId);
        await message.reply("Leaving voice.");
      } else if (message.mentions.has(runtime.env.discord.client.user?.id ?? "")) {
        const text = content.replace(/<@!?\d+>/g, "").trim();
        await runtime.env.memory.saveMessage({
          guildId: messageGuildId,
          channelId: message.channelId,
          userId: message.author.id,
          text,
          createdAt: Date.now(),
        });
        const response = await runtime.env.ai.streamResponse({
          userId: message.author.id,
          messages: [
            { role: "system", content: "You are Jettbot, a concise Discord assistant." },
            { role: "user", content: text },
          ],
        });
        let reply = "";
        for await (const token of response.text) reply += token;
        await message.reply(reply.slice(0, 1900) || "No response.");
      }
    })().catch((error) => {
      void message.reply(error instanceof Error ? error.message : String(error)).catch(() => undefined);
    });
  });
  return installedVoid(unsubscribe);
};
