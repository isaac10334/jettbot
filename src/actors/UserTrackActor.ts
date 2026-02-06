// This actor does NOT push frames through its mailbox.
// It creates a Port<Pcm16kMonoFrame> and hands it to, for example:

import {
    makePort,
    type Mailbox,
    type Ref,
    type Scope,
} from '../__internal/ActorRuntime';
import type {
    MixerMsg,
    Pcm16kMonoFrame,
    Services,
    SttMsg,
    UserId,
    UserTrackMsg,
} from '../types';

export type UserTrackMsg = { kind: 'start' } | { kind: 'stop' };

// MixerActor (for loopback path), or SttActor (Bot path)
export async function UserTrackActor(
    ctx: {
        self: Ref<UserTrackMsg>;
        scope: Scope;
        services: Services;
        mailbox: Mailbox<UserTrackMsg>;
    },
    opts: { userId: UserId },
) {
    const { userId } = opts;
    const { log, dir, discord, opus, clock } = ctx.services;

    // Create output port for decoded frames
    const frames = makePort<Pcm16kMonoFrame>({
        capacity: 64, // ~1.28s at 20ms frames
        overflow: 'dropOldest', // realtime-friendly
    });

    // Required dependencies, but recoverable via watchService
    let mixer: Ref<MixerMsg> | null = null;

    const unwatchMixer = dir.watchService<MixerMsg>('mixer', (ev) => {
        if (ev.kind === 'ready') {
            mixer = ev.ref!;
            mixer.tell({ kind: 'attachUser', userId, frames });
            log.info('UserTrack bound to mixer', { userId });
        } else {
            mixer = null;
            log.warn(
                'Mixer lost; UserTrack continues producing frames (dropping)',
                { userId },
            );
        }
    });

    // Spawn per-user STT as a child (ownership)
    // (This is super nice: STT dies when user track dies.)
    const sttFramesPort = frames; // same port, STT can read too
    const sttRef = dir.lookup<SttMsg>(`stt:${userId}`); // optional: you can do per-user named service

    // Or simpler: just start a local STT task in this actor
    // But we’ll do a real actor for your diagram.
    // For brevity: assume STT is a shared service factory (not shown).

    let running = false;

    const stopAll = () => {
        if (!running) return;
        running = false;
        frames.close();
        unwatchMixer();
    };

    ctx.scope.onCancel(stopAll);

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'start') {
            if (running) continue;
            running = true;

            // This is the realtime loop (data lane)
            (async () => {
                try {
                    for await (const opusPacket of discord.subscribeUserOpus(
                        userId,
                        ctx.scope.signal,
                    )) {
                        // decode
                        const pcm16 = opus.decodeTo16kMono(opusPacket);

                        // chunk into 20ms frames (assume decoder returns exactly 20ms for simplicity)
                        const frame: Pcm16kMonoFrame = {
                            userId,
                            sampleRateHz: 16000,
                            channels: 1,
                            samples: pcm16,
                            timestampMs: clock.nowMs(),
                        };

                        // jitter buffer would live here:
                        // - reorder
                        // - conceal loss
                        // - output steady 20ms cadence

                        frames.push(frame);
                    }
                } catch (err) {
                    if (!ctx.scope.signal.aborted)
                        log.error('UserTrack stream crashed', { userId, err });
                } finally {
                    frames.close();
                }
            })();
        }

        if (msg.kind === 'stop') {
            stopAll();
            return;
        }
    }
}
