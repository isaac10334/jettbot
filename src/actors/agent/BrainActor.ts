export type BrainMsg = {
    kind: 'attachTranscriptStream';
    transcripts: Port<{ userId: UserId; text: string; isFinal: boolean }>;
};

export async function BrainActor(ctx: {
    self: Ref<BrainMsg>;
    scope: Scope;
    services: Services;
    mailbox: Mailbox<BrainMsg>;
}) {
    const { log, dir, brain } = ctx.services;

    const unprovide = dir.provide('brain', ctx.self);
    ctx.scope.onCancel(unprovide);

    // We’ll merge multiple transcript ports into one internal port.
    const mergedTranscripts = makePort<Transcript>({
        capacity: 128,
        overflow: 'dropOldest',
    });

    // Text chunks output
    const textChunks = makePort<string>({
        capacity: 256,
        overflow: 'dropOldest',
    });

    // Bind to TTS as required dep
    const unwatchTts = dir.watchService<TtsMsg>('tts', (ev) => {
        if (ev.kind === 'ready') {
            ev.ref.tell({ kind: 'attachTextChunks', text: textChunks });
            log.info('Brain bound to TTS');
        }
    });

    ctx.scope.onCancel(() => {
        unwatchTts();
        mergedTranscripts.close();
        textChunks.close();
    });

    // Start the brain stream loop
    (async () => {
        try {
            for await (const chunk of brain.streamResponse(
                mergedTranscripts,
                ctx.scope.signal,
            )) {
                textChunks.push(chunk);
            }
        } catch (err) {
            if (!ctx.scope.signal.aborted) log.error('Brain crashed', { err });
        } finally {
            textChunks.close();
        }
    })();

    // Control plane: attach transcript ports
    while (!ctx.scope.signal.aborted) {
        const msg = await ctx.mailbox.pop();

        if (msg.kind === 'attachTranscriptStream') {
            const port = msg.transcripts;

            // Merge task
            (async () => {
                try {
                    for await (const t of port) mergedTranscripts.push(t);
                } catch {}
            })();
        }
    }
}
