export type TtsMsg = { kind: 'attachTextChunks'; text: Port<string> };

export async function TtsActor(ctx: {
    self: Ref<TtsMsg>;
    scope: Scope;
    services: Services;
    mailbox: Mailbox<TtsMsg>;
}) {
    const { log, dir, tts } = ctx.services;

    const unprovide = dir.provide('tts', ctx.self);
    ctx.scope.onCancel(unprovide);

    const pcmOut = makePort<MixedPcm48kStereoFrame>({
        capacity: 32,
        overflow: 'dropOldest',
    });

    // Required dependency: egress
    const unwatchEgress = dir.watchService<EgressMsg>('egress', (ev) => {
        if (ev.kind === 'ready') {
            ev.ref.tell({ kind: 'attachPcm', pcm: pcmOut });
            log.info('TTS bound to Egress');
        }
    });

    ctx.scope.onCancel(() => {
        unwatchEgress();
        pcmOut.close();
    });

    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'attachTextChunks') {
            const text = msg.text;

            (async () => {
                try {
                    for await (const pcm of tts.streamText(
                        text,
                        ctx.scope.signal,
                    )) {
                        pcmOut.push({
                            sampleRateHz: 48000,
                            channels: 2,
                            samples: pcm,
                            timestampMs: Date.now(),
                        });
                    }
                } catch (err) {
                    if (!ctx.scope.signal.aborted)
                        log.error('TTS crashed', { err });
                } finally {
                    pcmOut.close();
                }
            })();
        }
    }
}
