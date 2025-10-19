// Tiny helpers so index.ts stays clean.

export type Result<T, E = unknown> = { ok: true; value: T } | { ok: false; error: E }

export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms))
}

/** Ensure the handler runs once on SIGINT / SIGTERM / uncaught errors. */
export function installExitHooks(handler: () => Promise<void> | void): void {
  let ran = false
  async function runOnce(code = 0): Promise<void> {
    if (ran) return
    ran = true
    try {
      await handler()
    } catch {}
    // give stdout a tick to flush on Windows
    setTimeout(() => process.exit(code), 25)
  }

  process.once('SIGINT', () => void runOnce(0))
  process.once('SIGTERM', () => void runOnce(0))
  process.once('uncaughtException', async err => {
    console.error('[fatal] uncaughtException:', err)
    await runOnce(1)
  })
  process.once('unhandledRejection', async err => {
    console.error('[fatal] unhandledRejection:', err)
    await runOnce(1)
  })
}
