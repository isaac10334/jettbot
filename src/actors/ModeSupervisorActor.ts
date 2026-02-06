import type { Ref, Scope, Mailbox } from '../__internal/ActorRuntime';
import type { Services } from '../types';

export type Mode = 'loopback' | 'agent';
export type ModeSupervisorMsg = { kind: 'setMode'; mode: Mode };

export async function ModeSupervisorActor(ctx: {
    self: Ref<ModeSupervisorMsg>;
    scope: Scope;
    services: Services;
    mailbox: Mailbox<ModeSupervisorMsg>;
    spawn<M>(behavior: (ctx: any) => Promise<void>, name: string): Ref<M>;
}) {
    const { log } = ctx.services;

    let mode: Mode = 'agent';
    let current: Ref<any> | null = null;

    const mount = (m: Mode) => {
        // stop old subtree
        if (current) {
            // in a real runtime you'd have system messages for stop
            // e.g. current.tell({ kind: "$stop" })
        }

        mode = m;

        if (m === 'loopback') {
            current = ctx.spawn(
                (childCtx) => LoopbackPipelineActor(childCtx),
                'pipeline:loopback',
            );
        } else {
            current = ctx.spawn(
                (childCtx) => AgentPipelineActor(childCtx),
                'pipeline:agent',
            );
        }

        log.info('Mounted pipeline', { mode: m });
    };

    mount(mode);

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();
        if (msg.kind === 'setMode') {
            if (msg.mode === mode) continue;
            mount(msg.mode);
        }
    }
}
