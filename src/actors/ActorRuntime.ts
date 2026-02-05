export type ActorRef<M> = {
  send: (msg: M) => void
  stop: () => void
}

export type ActorContext<M> = {
  self: ActorRef<M>
  log: (...args: any[]) => void
  setTimer: (key: string, ms: number, msg: M) => void
  clearTimer: (key: string) => void
}

export function spawnActor<M>(
  name: string,
  onMessage: (ctx: ActorContext<M>, msg: M) => void,
  opts: { debug?: boolean } = {}
): ActorRef<M> {
  let stopped = false
  const q: M[] = []
  let draining = false
  const timers = new Map<string, NodeJS.Timeout>()

  const log = (...args: any[]) => {
    if (opts.debug) console.log(`[${name}]`, ...args)
  }

  const ref: ActorRef<M> = {
    send(msg) {
      if (stopped) return
      q.push(msg)
      if (!draining) drain()
    },
    stop() {
      if (stopped) return
      stopped = true
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      q.length = 0
    },
  }

  const ctx: ActorContext<M> = {
    self: ref,
    log,
    setTimer(key, ms, msg) {
      ctx.clearTimer(key)
      const t = setTimeout(() => ref.send(msg), ms)
      timers.set(key, t)
    },
    clearTimer(key) {
      const t = timers.get(key)
      if (t) clearTimeout(t)
      timers.delete(key)
    },
  }

  function drain() {
    draining = true
    queueMicrotask(() => {
      try {
        while (!stopped && q.length) {
          const msg = q.shift()!
          onMessage(ctx, msg)
        }
      } finally {
        draining = false
      }
    })
  }

  return ref
}
