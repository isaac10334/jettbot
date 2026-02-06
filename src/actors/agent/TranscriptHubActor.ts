import {
    type Ref,
    type Scope,
    type Mailbox,
    makePort,
    Port,
} from '../../__internal/ActorRuntime';
import type { TranscriptHubMsg, Services, BrainMsg, UserId } from '../../types';
import type { Transcript } from './SttActor';

export type UserId = string;

export type Transcript = {
    readonly userId: UserId;
    readonly text: string;
    readonly isFinal: boolean;
    readonly timestampMs: number;
};

export type TranscriptHubMsg =
    | { kind: 'attachUser'; userId: UserId; transcripts: Port<Transcript> }
    | { kind: 'detachUser'; userId: UserId };

export async function TranscriptHubActor(ctx: {
    self: Ref<TranscriptHubMsg>;
    scope: Scope;
    services: Services;
    mailbox: Mailbox<TranscriptHubMsg>;
}) {
    const { log, dir } = ctx.services;

    // Provide service so STT actors can bind to it
    const unprovide = dir.provide('transcriptHub', ctx.self);
    ctx.scope.onCancel(unprovide);

    // This is the merged output port
    const merged = makePort<Transcript>({
        capacity: 256,
        overflow: 'dropOldest',
    });

    // Bind to Brain as a required dep (recoverable)
    const unwatchBrain = dir.watchService<BrainMsg>('brain', (ev) => {
        if (ev.kind === 'ready') {
            ev.ref.tell({
                kind: 'attachTranscriptStream',
                transcripts: merged,
            });
            log.info('TranscriptHub bound merged stream to Brain');
        } else {
            log.warn(
                'Brain lost; TranscriptHub continues collecting transcripts (dropping if full)',
            );
        }
    });

    ctx.scope.onCancel(() => {
        unwatchBrain();
        merged.close();
    });

    // Keep per-user consumer tasks alive
    const attached = new Map<UserId, { port: Port<Transcript> }>();

    const startMergeTask = (userId: UserId, port: Port<Transcript>) => {
        (async () => {
            try {
                for await (const t of port) {
                    // POLICY: final-only (very sane default)
                    if (!t.isFinal) continue;

                    merged.push(t);
                }
            } catch (err) {
                // user port ended or crashed
            } finally {
                attached.delete(userId);
            }
        })();
    };

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'attachUser') {
            attached.set(msg.userId, { port: msg.transcripts });
            startMergeTask(msg.userId, msg.transcripts);
            log.info('TranscriptHub attached user', { userId: msg.userId });
        }

        if (msg.kind === 'detachUser') {
            attached.delete(msg.userId);
            log.info('TranscriptHub detached user', { userId: msg.userId });
        }
    }
}
