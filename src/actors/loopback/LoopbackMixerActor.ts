// Mixer is a shared service.

import type { log } from "node:console"
import { type Ref, type Scope, type Mailbox, Port, makePort } from "../../__internal/ActorRuntime"

// It is a root actor (provided under "mixer").
// User tracks attach via mailbox (control plane).
// Mixer reads frames via ports (data plane).



export type MixerMsg =
| { kind: 'attachUser'; userId: UserId; frames: Port<Pcm16kMonoFrame> }
| { kind: 'detachUser'; userId: UserId };

// Mixer outputs to Egress as a Port<MixedPcm48kStereoFrame>.

export async function LoopbackMixerActor(ctx: {
  self: Ref<MixerMsg>
  scope: Scope
  services: Services
  mailbox: Mailbox<MixerMsg>
}) {
  const { log, dir, clock } = ctx.services

  // Provide service name
  const unprovide = dir.provide('mixer', ctx.self)
  ctx.scope.onCancel(unprovide)

  // Map user -> port
  const users = new Map<UserId, Port<Pcm16kMonoFrame>>();

  // Output port to Egress
  const mixedOut = makePort<MixedPcm48kStereoFrame>({
    capacity: 8,
    overflow: 'dropOldest',
  })

  // Bind to Egress as a required dependency
  const unwatchEgress = dir.watchService<EgressMsg>('egress', ev => {
    if (ev.kind === 'ready') {
      ev.ref.tell({ kind: 'attachPcm', pcm: mixedOut })
      log.info('Mixer bound to Egress')
    } else {
      log.warn('Egress lost; Mixer continues mixing (dropping)')
    }
    }
  })

  ctx.scope.onCancel(() => {
    unwatchEgress();
    mixedOut.close()
  })

  // Consumer tasks: each user gets a "latest frame" slot
  const latest = new Map<UserId, Pcm16kMonoFrame>()

  const startUserConsumer = (userId: UserId, port: Port<Pcm16kMonoFrame>) => {
    ;(async () => {
      try {
        for await (const frame of port) {
          latest.set(userId, frame)
        }
      } catch (err) {
        // ignore
      } finally {
        latest.delete(userId)
      }
    })()
  }

  // Mix tick loop (20ms)
  ;(async () => {
    while (!ctx.scope.signal.aborted) {
      await clock.sleep(20, ctx.scope.signal)

      // naive mix: sum latest frames
      // (In reality you’d resample to 48k, apply gains, limiter, fairness, etc.)

      // If no users, you might emit silence or nothing.
      if (latest.size === 0) continue

      const outSamples = new Int16Array(960 * 2) // 20ms @48k stereo

      // ...mix logic omitted...
      // For demo: silence

      mixedOut.push({
        sampleRateHz: 48000,
        channels: 2,
        samples: outSamples,
        timestampMs: clock.nowMs(),
      })
    }
  })()

  // Control plane
  while (!ctx.scope.signal.aborted) {
    const msg = await ctx.mailbox.pop()

    if (msg.kind === 'attachUser') {
      users.set(msg.userId, msg.frames)
      startUserConsumer(msg.userId, msg.frames)
      log.info('Mixer attached user', { userId: msg.userId })
    }

    if (msg.kind === 'detachUser') {
      users.delete(msg.userId)
      latest.delete(msg.userId)
      log.info('Mixer detached user', { userId: msg.userId })
    }
  }
}
