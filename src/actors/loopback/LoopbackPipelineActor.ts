import type { Scope, Ref } from '../../__internal/ActorRuntime';
import { LoopbackMixerActor } from './LoopbackMixerActor';

export async function LoopbackPipelineActor(ctx: {
    scope: Scope;
    services: CoreServices;
    spawn<M>(behavior: (ctx: any) => Promise<void>, name: string): Ref<M>;
}) {
    // Spawn loopback mixer as child
    ctx.spawn((childCtx) => LoopbackMixerActor(childCtx), 'loopbackMixer');

    // Then just idle forever until cancelled
    await new Promise<void>((resolve) => ctx.scope.onCancel(resolve));
}
