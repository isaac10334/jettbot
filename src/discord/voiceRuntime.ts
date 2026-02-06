import type { Readable } from 'node:stream';
import {
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
    NoSubscriberBehavior,
    StreamType,
    VoiceConnectionStatus,
    type AudioPlayer,
    type VoiceConnection,
} from '@discordjs/voice';
import type { Guild } from 'discord.js';

export type VoiceRuntime = {
    conn: VoiceConnection;
    player: AudioPlayer;
    receiver: VoiceConnection['receiver'];
    playOpusStream: (opus: Readable) => void;
    destroy: () => void;
};

export async function joinVoiceRuntime(opts: {
    guild: Guild;
    channelId: string;
    selfDeaf?: boolean;
    selfMute?: boolean;
    readyTimeoutMs?: number;
}): Promise<VoiceRuntime> {
    const conn = joinVoiceChannel({
        channelId: opts.channelId,
        guildId: opts.guild.id,
        adapterCreator: opts.guild.voiceAdapterCreator,
        selfDeaf: opts.selfDeaf ?? false,
        selfMute: opts.selfMute ?? false,
    });

    await entersState(
        conn,
        VoiceConnectionStatus.Ready,
        opts.readyTimeoutMs ?? 20_000,
    );

    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    player.on('stateChange', (o, n) =>
        console.log('[player]', o.status, '->', n.status),
    );

    const sub = conn.subscribe(player);
    if (!sub) {
        conn.destroy();
        throw new Error(
            'conn.subscribe(player) returned null (not subscribed)',
        );
    }

    const receiver = conn.receiver;

    const playOpusStream = (opus: Readable) => {
        const resource = createAudioResource(opus, {
            inputType: StreamType.Opus,
        });
        player.play(resource);
    };

    const destroy = () => {
        try {
            player.stop(true);
        } catch {}
        try {
            conn.destroy();
        } catch {}
    };

    return { conn, player, receiver, playOpusStream, destroy };
}
