// Ports: These let actors talk to each other!
export type OverflowPolicy = 'dropOldest' | 'dropNewest' | 'block';

export type InPort<T> = AsyncIterable<T>;
export type OutPort<T> = { push(v: T): boolean; close(err?: unknown): void };
export type PortPair<T> = { in: InPort<T>; out: OutPort<T> };

export function makePort<T>(opts: {
    capacity: number;
    overflow: OverflowPolicy;
}): Port<T> {
    const q: T[] = [];
    let closed: unknown | null = null;

    const waiters: Array<(v: IteratorResult<T>) => void> = [];
    const pushWaiters: Array<() => void> = [];

    const wakeConsumer = () => {
        if (waiters.length > 0 && q.length > 0) {
            const w = waiters.shift()!;
            const v = q.shift()!;
            w({ value: v, done: false });
        }
    };

    const wakeProducer = () => {
        if (pushWaiters.length > 0 && q.length < opts.capacity) {
            pushWaiters.shift()!();
        }
    };

    const push = (value: T): boolean => {
        if (closed != null) return false;

        // Fast path: consumer waiting
        if (waiters.length > 0) {
            const w = waiters.shift()!;
            w({ value, done: false });
            return true;
        }

        if (q.length < opts.capacity) {
            q.push(value);
            return true;
        }

        // overflow handling
        if (opts.overflow === 'dropNewest') return false;

        if (opts.overflow === 'dropOldest') {
            q.shift();
            q.push(value);
            return true;
        }

        // block (rarely used in realtime audio, but good for control-ish streams)
        // We can't truly block sync, so: dropNewest is usually better.
        return false;
    };

    const close = (err?: unknown) => {
        if (closed != null) return;
        closed = err ?? new Error('Port closed');
        for (const w of waiters.splice(0)) {
            w({ value: undefined as any, done: true });
        }
        for (const pw of pushWaiters.splice(0)) pw();
    };

    async function* iter(): AsyncGenerator<T> {
        while (true) {
            if (q.length > 0) {
                const v = q.shift()!;
                wakeProducer();
                yield v;
                continue;
            }
            if (closed != null) return;

            const next = await new Promise<IteratorResult<T>>((resolve) => {
                waiters.push(resolve);
            });

            if (next.done) return;
            yield next.value;
        }
    }

    return { push, close, [Symbol.asyncIterator]: iter };
}

// Ref is a handle to a mailbox or port
export type Ref<M> = {
    readonly id: string;
    tell(msg: M): void;
};

// Here's a revokable version:
type RevokableRef<M> = Ref<M> & { revoke(): void };
function makeRevokable<M>(ref: Ref<M>): RevokableRef<M> {
    let live = true;
    return {
        ...ref,
        tell(msg) {
            if (!live) return;
            ref.tell(msg);
        },
        revoke() {
            live = false;
        },
    };
}

export type Mailbox<M> = {
    push(msg: M): void;
    pop(): Promise<M>;
    close(err?: unknown): void;
};

export function makeMailbox<M>(): Mailbox<M> {
    const q: M[] = [];
    let closed: unknown | null = null;
    const waiters: Array<(m: M) => void> = [];

    return {
        push(msg) {
            if (closed != null) return;
            if (waiters.length > 0) return waiters.shift()!(msg);
            q.push(msg);
        },
        async pop() {
            if (q.length > 0) return q.shift()!;
            if (closed != null) throw closed;
            return await new Promise<M>((resolve) => waiters.push(resolve));
        },
        close(err) {
            closed = err ?? new Error('Mailbox closed');
            // best effort: wake waiters by throwing on next loop
            for (const w of waiters.splice(0)) w(undefined as any);
        },
    };
}

// Scope - structured cancellation
export interface Scope {
    readonly signal: AbortSignal;
    fork(): Scope;
    onCancel(fn: () => void): void;
}

export function makeScope(parent?: AbortSignal): Scope {
    const ac = new AbortController();
    if (parent)
        parent.addEventListener('abort', () => ac.abort(parent.reason), {
            once: true,
        });

    const onCancelFns: Array<() => void> = [];
    ac.signal.addEventListener(
        'abort',
        () => {
            for (const fn of onCancelFns.splice(0)) fn();
        },
        { once: true },
    );

    return {
        signal: ac.signal,
        fork() {
            return makeScope(ac.signal);
        },
        onCancel(fn) {
            if (ac.signal.aborted) fn();
            else onCancelFns.push(fn);
        },
    };
}

// Deps! Service directory pattern with the ability tos wap them out and
export type StopReason = { kind: 'normal' } | { kind: 'crash'; error: unknown };

export type WatchEvent = { kind: 'stopped'; reason: StopReason };

export type Watcher = (ev: WatchEvent) => void;

export type ServiceName = string;

export interface Directory {
    provide(name: ServiceName, ref: Ref<any>): () => void;
    lookup<M>(name: ServiceName): Ref<M> | null;

    // signal subscription
    watchService<M>(
        name: ServiceName,
        fn: (ev: { kind: 'ready'; ref: Ref<M> } | { kind: 'lost' }) => void,
    ): () => void;
}

// Minimal directory impl
export function makeDirectory(): Directory {
    const services = new Map<ServiceName, Ref<any>>();
    const watchers = new Map<ServiceName, Set<(ev: any) => void>>();

    const notify = (name: ServiceName, ev: any) => {
        const ws = watchers.get(name);
        if (!ws) return;
        for (const w of ws) w(ev);
    };

    return {
        provide(name, ref) {
            services.set(name, ref);
            notify(name, { kind: 'ready', ref });

            return () => {
                const cur = services.get(name);
                if (cur?.id === ref.id) {
                    services.delete(name);
                    notify(name, { kind: 'lost' });
                }
            };
        },

        lookup(name) {
            return (services.get(name) ?? null) as any;
        },

        watchService(name, fn) {
            let ws = watchers.get(name);
            if (!ws) watchers.set(name, (ws = new Set()));
            ws.add(fn as any);

            // immediate fire
            const cur = services.get(name);
            if (cur) fn({ kind: 'ready', ref: cur });
            else fn({ kind: 'lost' });

            return () => {
                ws!.delete(fn as any);
            };
        },
    };
}
