/** 2) Minimal, generic, functional event bus */
export function makeBus<M extends Record<string, any>>() {
  type T = keyof M & string;
  const handlers: { [K in T]: Set<(p: M[K]) => void> } = Object.create(null);
  const ensure = (k: T) => (handlers[k] ??= new Set());

  const on = <K extends T>(type: K, fn: (p: M[K]) => void) => (ensure(type).add(fn), () => off(type, fn));
  const once = <K extends T>(type: K, fn: (p: M[K]) => void) => {
    const offFn = on(type, (p) => { offFn(); fn(p); });
    return offFn;
  };
  const off = <K extends T>(type: K, fn: (p: M[K]) => void) => ensure(type).delete(fn);
  const emit = <K extends T>(type: K, payload: M[K]) => { for (const fn of ensure(type)) fn(payload); };

  return { on, once, off, emit };
}
