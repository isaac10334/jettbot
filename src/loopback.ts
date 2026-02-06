import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { VoiceChannelSession } from './bot/VoiceSessionActor';
import { joinVoiceRuntime } from './discord/voiceRuntime';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? '';
const GUILD_ID = process.env.GUILD_ID ?? '';
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID ?? '';

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!GUILD_ID) throw new Error('Missing GUILD_ID');
if (!VOICE_CHANNEL_ID) throw new Error('Missing VOICE_CHANNEL_ID');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel],
});

client.once(Events.ClientReady, async () => {
    console.log(`[ready] ${client.user?.tag}`);

    const guild = await client.guilds.fetch(GUILD_ID);

    const vr = await joinVoiceRuntime({
        guild,
        channelId: VOICE_CHANNEL_ID,
        selfDeaf: true,
        selfMute: false,
    });

    console.log(`[voice] connected; receiver ready`);

    const session = new VoiceChannelSession(
        vr,
        client,
        GUILD_ID,
        VOICE_CHANNEL_ID,
        {
            debug: true,
            targetFrames: 25,
            maxFrames: 200,
            resubscribeAfterMs: 2000, // auto-heal
            outputSilenceWhenEmpty: true,
        },
    );

    session.setLoopbackMode({ kind: 'mix_all' });
    // session.setLoopbackMode({ kind: "auto_active" });

    await session.start();
    console.log(`[startup] voice channel session running`);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

await client.login(DISCORD_TOKEN);
