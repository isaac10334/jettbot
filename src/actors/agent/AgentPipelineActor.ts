import type { Scope, Ref } from '../../__internal/ActorRuntime';
import { TranscriptHubActor } from './TranscriptHubActor';

export async function AgentPipelineActor(ctx: {
    scope: Scope;
    services: CoreServices;
    spawn<M>(behavior: (ctx: any) => Promise<void>, name: string): Ref<M>;
}) {
    ctx.spawn((childCtx) => TranscriptHubActor(childCtx), 'transcriptHub');

    await new Promise<void>((resolve) => ctx.scope.onCancel(resolve));
}
