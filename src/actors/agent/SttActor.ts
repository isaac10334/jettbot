// This is per-user, so it should be owned by UserTrackActor or VoiceIngressActor.
// It receives frames via a Port and outputs transcripts via another Port.

import {
    makePort,
    type Mailbox,
    type Port,
    type Ref,
    type Scope,
} from '../../__internal/ActorRuntime';
import type {
    BrainMsg,
    Pcm16kMonoFrame,
    Services,
    SttMsg,
    TranscriptHubMsg,
    UserId,
} from '../../types';

export type SttMsg =
    | { kind: 'attachFrames'; frames: Port<Pcm16kMonoFrame> }
    | { kind: 'stop' };

export type Transcript = {
    readonly userId: UserId;
    readonly text: string;
    readonly isFinal: boolean;
};

export async function SttActor(
    ctx: {
        self: Ref<SttMsg>;
        scope: Scope;
        services: Services;
        mailbox: Mailbox<SttMsg>;
    },
    opts: { userId: UserId },
) {
    const { userId } = opts;
    const { log, stt, dir } = ctx.services;

    // Provide per-user service name so Brain can depend on it if desired
    const unprovide = dir.provide(`stt:${userId}`, ctx.self);
    ctx.scope.onCancel(unprovide);

    const transcripts = makePort<Transcript>({
        capacity: 32,
        overflow: 'dropOldest',
    });

    // Brain dependency: required, recoverable
    // const unwatchBrain = dir.watchService<BrainMsg>('brain', (ev) => {
    //     if (ev.kind === 'ready') {
    //         // We don't send per-frame, we send a port handle
    //         // But Brain expects a single transcript stream, so in practice
    //         // you'd have a TranscriptHubActor. We'll keep it simple:
    //         ev.ref.tell({ kind: 'attachTranscriptStream', transcripts });
    //         log.info('STT bound transcripts to Brain', { userId });
    //     }
    // });

    // Instead of watching the brain, we now should weatch the transcript merger:
    const unwatchTranscript = dir.watchService<TranscriptHubMsg>(
        'transcriptHub',
        (ev) => {
            if (ev.kind === 'ready') {
                ev.ref.tell({ kind: 'attachUser', userId, transcripts });
            }
        },
    );

    ctx.scope.onCancel(() => {
        unwatchTranscript();
        transcripts.close();
    });

    let frames: Port<Pcm16kMonoFrame> | null = null;

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'attachFrames') {
            frames = msg.frames;
            (async () => {
                try {
                    const stream = stt.streamUserAudio(
                        userId,
                        frames!,
                        ctx.scope.signal,
                    );
                    for await (const t of stream) {
                        transcripts.push({
                            userId,
                            text: t.text,
                            isFinal: t.isFinal,
                        });
                    }
                } catch (err) {
                    if (!ctx.scope.signal.aborted)
                        log.error('STT crashed', { userId, err });
                } finally {
                    transcripts.close();
                }
            })();
        }

        if (msg.kind === 'stop') return;
    }
}
