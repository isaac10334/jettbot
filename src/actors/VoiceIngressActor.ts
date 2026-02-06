import type { Mailbox, Ref, Scope } from '../__internal/ActorRuntime';
import type {
    MixerMsg,
    Services,
    UserId,
    UserTrackMsg,
    VoiceIngressMsg,
} from '../types';
import { UserTrackActor } from './UserTrackActor';

// Message types for various actors:
export type VoiceIngressMsg =
    | { kind: 'voiceJoin'; userId: UserId }
    | { kind: 'voiceLeave'; userId: UserId };

// This actor is the “tree root” for all per-user pipelines.
export async function VoiceIngressActor(ctx: {
    self: Ref<VoiceIngressMsg>;
    scope: Scope;
    services: Services;
    spawn<M>(behavior: (ctx: any) => Promise<void>, name: string): Ref<M>;
    mailbox: Mailbox<VoiceIngressMsg>;
}) {
    const { log, dir } = ctx.services;

    // Required dependencies (by name)
    const mixer = dir.lookup<MixerMsg>('mixer');
    if (!mixer) throw new Error('Mixer service missing at startup (required)');

    const tracks = new Map<UserId, Ref<UserTrackMsg>>();

    log.info('VoiceIngressActor started');

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'voiceJoin') {
            if (tracks.has(msg.userId)) continue;

            // Create per-user track
            const trackRef = ctx.spawn<UserTrackMsg>(
                (childCtx) => UserTrackActor(childCtx, { userId: msg.userId }),
                `user-track:${msg.userId}`,
            );

            tracks.set(msg.userId, trackRef);
            trackRef.tell({ kind: 'start' });

            log.info('spawned UserTrackActor', { userId: msg.userId });
        }

        if (msg.kind === 'voiceLeave') {
            const tr = tracks.get(msg.userId);
            if (!tr) continue;

            tr.tell({ kind: 'stop' });
            tracks.delete(msg.userId);

            log.info('stopped UserTrackActor', { userId: msg.userId });
        }
    }
}
