import type { Readable } from 'node:stream';
import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { PcmFrameChunker } from '../audio/pcmFrameChunker';
import { PcmJitterBuffer } from '../audio/pcmJitterBuffer';
import { StereoToMono16LE } from '../audio/stereoToMono16le';
import type { VoiceRuntime } from '../discord/voiceRuntime';
import type { Logger } from '../app/logging';

const RATE = 48_000;
const OPUS_FRAME_SIZE = 960; // 20ms @ 48kHz

const DECODE_CHANNELS = 2; // Discord receiver gives stereo PCM
const ENCODE_CHANNELS = 1; // we store/mix mono

const BYTES_PER_SAMPLE = 2;
const MONO_FRAME_BYTES = OPUS_FRAME_SIZE * ENCODE_CHANNELS * BYTES_PER_SAMPLE; // 1920
const STEREO_FRAME_BYTES = OPUS_FRAME_SIZE * DECODE_CHANNELS * BYTES_PER_SAMPLE; // 3840

type Pipeline = {
    opusIn: Readable | null;
    decoder: prism.opus.Decoder | null;
    stereoChunker: PcmFrameChunker | null;
    downmix: StereoToMono16LE | null;
    monoChunker: PcmFrameChunker | null;
};

export class UserTrackActor {
    public readonly jitter: PcmJitterBuffer;

    private pipeline: Pipeline = {
        opusIn: null,
        decoder: null,
        stereoChunker: null,
        downmix: null,
        monoChunker: null,
    };

    // Activity timestamps
    public lastOpusAt = 0;
    public lastPcmAt = 0;

    // Stats (reset by VoiceChannelSession once/sec)
    public opusPktsThisSec = 0;
    public pcmFramesThisSec = 0;
    public biggestOpusGapMs = 0;
    public resubscribeCount = 0;
    public stallCount = 0;
    public decodeTimeoutCount = 0;
    public errorCount = 0;

    private lastOpusTs = 0;

    private stopped = false;
    private activeGen = 0;

    // Per-subscribe state
    private sawAnyOpusSinceSubscribe = false;
    private sawAnyPcmSinceSubscribe = false;

    // Backoff (prevents thrash)
    private backoffMs = 0;
    private backoffUntil = 0;

    constructor(
        private readonly vr: VoiceRuntime,
        public readonly userId: string,
        private readonly opts: {
            targetFrames: number;
            maxFrames: number;
            debug?: boolean;
            resubscribeAfterMs: number;
            logger: Logger;
        },
    ) {
        this.jitter = new PcmJitterBuffer({
            targetFrames: opts.targetFrames,
            maxFrames: opts.maxFrames,
        });
    }

    start() {
        this.subscribeFresh('startup');

        const supervise = () => {
            if (this.stopped) return;

            const now = Date.now();

            // If user never spoke since the last subscribe, do nothing.
            // (Silent users should NOT churn subscriptions.)
            if (!this.sawAnyOpusSinceSubscribe) {
                setTimeout(supervise, 500);
                return;
            }

            const dt = this.lastOpusAt ? now - this.lastOpusAt : 0;

            if (this.lastOpusAt && dt > this.opts.resubscribeAfterMs) {
                this.stallCount++;
                if (this.opts.debug) {
                    this.opts.logger.warn('voice.track.stalled', {
                        userId: this.userId,
                        stalledForMs: dt,
                    });
                }
                this.bumpBackoff();
                this.subscribeFresh('stall');
            }

            setTimeout(supervise, 500);
        };

        setTimeout(supervise, 500);
    }

    stop() {
        this.stopped = true;
        this.destroyPipeline(this.pipeline);
        this.jitter.clear();
    }

    popFrameTick(): Buffer | null {
        return this.jitter.popTick();
    }

    private subscribeFresh(
        reason: 'startup' | 'stall' | 'decode_timeout' | 'error',
    ) {
        if (this.stopped) return;

        const now = Date.now();
        if (now < this.backoffUntil) return;

        const gen = ++this.activeGen;
        this.resubscribeCount++;

        const old = this.pipeline;

        const safe = (fn: () => void) => {
            try {
                fn();
            } catch {}
        };

        // New receive stream
        const opusIn = this.vr.receiver.subscribe(this.userId, {
            end: { behavior: EndBehaviorType.Manual },
        });

        // Prism decoder: opus -> stereo PCM16 @ 48k
        const decoder = new prism.opus.Decoder({
            rate: RATE,
            channels: DECODE_CHANNELS,
            frameSize: OPUS_FRAME_SIZE,
        });

        // Chunk stereo into exact 20ms frames
        const stereoChunker = new PcmFrameChunker(STEREO_FRAME_BYTES);

        // Downmix to mono
        const downmix = new StereoToMono16LE();

        // Chunk mono into exact 20ms frames
        const monoChunker = new PcmFrameChunker(MONO_FRAME_BYTES);

        const next: Pipeline = {
            opusIn,
            decoder,
            stereoChunker,
            downmix,
            monoChunker,
        };
        this.pipeline = next;

        // Reset per-subscribe state
        this.sawAnyOpusSinceSubscribe = false;
        this.sawAnyPcmSinceSubscribe = false;

        // Reset jitter + time stats
        this.jitter.clear();
        this.lastOpusAt = 0;
        this.lastPcmAt = 0;
        this.biggestOpusGapMs = 0;
        this.lastOpusTs = 0;

        // Stats
        this.opusPktsThisSec = 0;
        this.pcmFramesThisSec = 0;

        // Track opus activity
        opusIn.on('data', () => {
            if (gen !== this.activeGen) return;

            this.sawAnyOpusSinceSubscribe = true;
            this.opusPktsThisSec++;

            const t = Date.now();
            this.lastOpusAt = t;

            if (this.lastOpusTs) {
                const gap = t - this.lastOpusTs;
                if (gap > this.biggestOpusGapMs) this.biggestOpusGapMs = gap;
            }
            this.lastOpusTs = t;
        });

        // Wire pipeline
        opusIn
            .pipe(decoder)
            .pipe(stereoChunker)
            .pipe(downmix)
            .pipe(monoChunker);

        let sawFirstFrame = false;

        monoChunker.on('data', (monoFrame: Buffer) => {
            if (gen !== this.activeGen) return;

            if (monoFrame.length !== MONO_FRAME_BYTES) {
                if (this.opts.debug) {
                    this.opts.logger.warn('voice.track.bad_mono_frame', {
                        userId: this.userId,
                        receivedBytes: monoFrame.length,
                        expectedBytes: MONO_FRAME_BYTES,
                    });
                }
                return;
            }

            this.sawAnyPcmSinceSubscribe = true;
            this.lastPcmAt = Date.now();
            this.pcmFramesThisSec++;
            this.jitter.push(monoFrame);

            if (!sawFirstFrame) {
                sawFirstFrame = true;

                // Success => reset backoff
                this.backoffMs = 0;
                this.backoffUntil = 0;

                // Destroy old pipeline now
                this.destroyPipeline(old);

                if (this.opts.debug) {
                    this.opts.logger.debug('voice.track.resubscribe_ok', {
                        userId: this.userId,
                        generation: gen,
                        reason,
                    });
                }
            }
        });

        const onErr = (label: string) => (err?: unknown) => {
            if (this.stopped) return;
            if (gen !== this.activeGen) return;

            this.errorCount++;

            if (this.opts.debug) {
                this.opts.logger.warn('voice.track.pipeline_error', {
                    userId: this.userId,
                    label,
                    error: String(err ?? ''),
                });
            }

            this.bumpBackoff();
            this.subscribeFresh('error');
        };

        opusIn.once('error', onErr('opusIn'));
        decoder.once('error', onErr('decoder'));
        stereoChunker.once('error', onErr('stereoChunker'));
        downmix.once('error', onErr('downmix'));
        monoChunker.once('error', onErr('monoChunker'));

        // Decode timeout:
        // Only retry if we are receiving opus but never got PCM.
        setTimeout(() => {
            if (this.stopped) return;
            if (gen !== this.activeGen) return;
            if (sawFirstFrame) return;

            if (!this.sawAnyOpusSinceSubscribe) return;
            if (this.sawAnyPcmSinceSubscribe) return;

            this.decodeTimeoutCount++;

            if (this.opts.debug) {
                this.opts.logger.warn('voice.track.decode_timeout', {
                    userId: this.userId,
                });
            }

            this.bumpBackoff();
            this.subscribeFresh('decode_timeout');
        }, 1500);

        // If the subscribe never produces frames, don't let it keep old pipeline alive forever.
        // (This prevents the hot-swap approach from leaking pipelines.)
        setTimeout(() => {
            if (this.stopped) return;
            if (gen !== this.activeGen) return;
            if (sawFirstFrame) return;

            // This pipeline is dead; kill it.
            safe(() => this.destroyPipeline(next));
        }, 5000);
    }

    private bumpBackoff() {
        // 0 -> 250 -> 500 -> 900 -> 1600 -> 2000 (cap)
        const next = this.backoffMs
            ? Math.min(2000, Math.floor(this.backoffMs * 1.8))
            : 250;
        this.backoffMs = next;
        this.backoffUntil = Date.now() + next;
    }

    private destroyPipeline(p: Pipeline) {
        if (!p.opusIn && !p.decoder) return;

        const safe = (fn: () => void) => {
            try {
                fn();
            } catch {}
        };

        // Stop flow first
        safe(() => p.opusIn?.unpipe());

        // Remove listeners (important for leaks)
        safe(() => p.opusIn?.removeAllListeners());

        // Destroy receive stream (Readable.destroy exists)
        safe(() => p.opusIn?.destroy());

        // Destroy downstream
        safe(() => p.decoder?.destroy());
        safe(() => p.stereoChunker?.destroy());
        safe(() => p.downmix?.destroy());
        safe(() => p.monoChunker?.destroy());

        // Ensure references die
        p.opusIn = null;
        p.decoder = null;
        p.stereoChunker = null;
        p.downmix = null;
        p.monoChunker = null;
    }
}
