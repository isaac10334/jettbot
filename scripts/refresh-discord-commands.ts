import Bun from 'bun';
import { REST, Routes } from 'discord.js';
import { slashCommands } from '../apps/bot/src/discord/DiscordCommands';

const requireEnv = (name: string): string => {
    const value = Bun.env[name];
    if (!value?.trim()) throw new Error(`${name} is required`);
    return value;
};

const botToken = requireEnv('DISCORD_BOT_TOKEN');
const applicationId = requireEnv('DISCORD_APPLICATION_ID');
const guildId = Bun.env.DISCORD_GUILD_ID?.trim() || undefined;

const rest = new REST({ version: '10' }).setToken(botToken);

const route = guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);

const scope = guildId ? `guild ${guildId}` : 'global';

console.log(`Clearing Discord slash commands for ${scope}.`);
await rest.put(route, { body: [] });

console.log(
    `Registering ${slashCommands.length} Discord slash commands for ${scope}.`,
);
await rest.put(route, { body: slashCommands });

console.log('Discord slash commands refreshed.');
