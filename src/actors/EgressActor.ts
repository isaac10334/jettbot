export type EgressMsg = {
    kind: 'attachPcm';
    pcm: Port<MixedPcm48kStereoFrame>;
};

export async function EgressActor(ctx: {
    self: Ref<EgressMsg>;
    scope: Scope;
    services: Services;
    mailbox: Mailbox<EgressMsg>;
}) {
    const { log, dir, opus, discord } = ctx.services;

    const unprovide = dir.provide('egress', ctx.self);
    ctx.scope.onCancel(unprovide);

    let pcm: Port<MixedPcm48kStereoFrame> | null = null;

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'attachPcm') {
            pcm = msg.pcm;
            (async () => {
                try {
                    for await (const frame of pcm!) {
                        const opusPacket = opus.encode48kStereo(frame.samples);
                        discord.sendOpus(opusPacket);
                    }
                } catch (err) {
                    if (!ctx.scope.signal.aborted)
                        log.error('Egress stream crashed', { err });
                }
            })();
        }
    }
}
