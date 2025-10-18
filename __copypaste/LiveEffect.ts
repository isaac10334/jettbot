
/* types.ts (heavy lifting) */
  export type LivePure<F extends Function = ArrowFunction> = undefined | null | DeferredCall<F> | LivePure<any>[];
  export type LiveElement<F extends Function = ArrowFunction> = undefined | null | false | DeferredCall<F> | LiveElement[] | ReactElementInterop;
  export type LiveNode<F extends Function = ArrowFunction> = LiveElement<F> | string | number | ArrowFunction | Array<LiveNode<any>>;

  // Live function
  export type ArrowFunction = (...args: any[]) => any;
  export type LiveFunction<F extends Function = ArrowFunction> = F;
  // Component with single props object
  export type RawLiveComponent<P> = (props: P) => LiveElement;
  // React/JSX types interop
  export type PropsWithChildren<P> = P & { children?: LiveElement<any> };
  export type PropsWithMarkup<P> = P & { children?: LiveNode<any> };
  export type LiveComponent<P = object> = ((props: P) => any) & { displayName?: string };
  export type Component<P = object> = LiveComponent<P>;
  export type RunProp<T extends any[]> = (...args: T) => LiveElement;
  export type LC<P = object> = LiveComponent<P>;
  export type Ref<T> = { current: T; };
  export type RefObject<T> = { current: T | null };
  export interface MutableRefObject<T> { current: T; };
  export type ReactElementInterop = {
    type: any,
    props: any,
    key: any,
  };
  // Mounting key
  export type Key = string | number;
  // Deferred function calls
  export type FunctionCall<F extends Function = ArrowFunction> = {
    f: LiveFunction<F>,
    args?: any[],
    arg?: any
  };
  export type DeferredCall<F extends Function = ArrowFunction> = FunctionCall<F> & {
    key?: Key,
    by?: number,
  };
  export type DeferredCallInterop<F extends Function = ArrowFunction> = DeferredCall<F> | ReactElementInterop;
  // State hook callbacks
  export type Initial<T> = (() => T) | T;
  export type Reducer<T> = T | ((t: T) => T);
  export type Setter<T> = (t: Reducer<T>) => void;
  export type Resource<T> = () => (void | Task | [T, Task]);
  export type DoubleState<T> = [() => T, () => [T, T]];
  // Renderer options
  export type RunOptions = {
    // Stack slicing depth
    stackSliceDepth: number,

    // Strict queue reordering
    strictQueueOrder: boolean,

    // Strict stack slice reordering
    strictSliceOrder: boolean,
  };
  // Hook types
  export enum Hook {
    STATE = 0,
    MEMO = 1,
    ONE = 2,
    CALLBACK = 3,
    RESOURCE = 4,
    CONTEXT = 5,
    CAPTURE = 6,
    VERSION = 7,
    HOOKS = 8,
  };
  // Deferred actions
  export type Task = () => void;
  export type MaybeTask = () => boolean;
  // Render callbacks
  export type OnFiber<T = any> = (fiber: LiveFiber<any>) => T;
  export type FiberSetter<T> = (fiber: LiveFiber<any>, t: T) => void;
  export type FiberGather<T> = (fiber: LiveFiber<any>, self?: boolean) => T;
  export type RunCallbacks = {
    dispatch: OnFiber<void>,
    onRender: (fiber: LiveFiber<any>, allowSlice?: boolean) => boolean,
    onUpdate: OnFiber<void>,
    onFence: OnFiber<void>,
  };

  // User=defined context
  export type LiveContext<T> = {
    initialValue?: T,
    displayName?: string,
    context?: true,
    capture?: false,
    reconciler?: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type LiveCapture<T> = {
    displayName?: string,
    context?: false,
    capture?: true,
    reconciler?: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type LiveReconciler<T> = {
    displayName?: string,
    capture?: false,
    context?: false,
    reconciler?: true,

    reconcile: (el: LiveElement) => LiveElement,
    quote: (el: LiveElement) => LiveElement,
    signal: () => LiveElement,
  };
  export type LiveMap<T> = Map<LiveFiber<any>, T>;

  // Fiber data structure
  export type LiveFiber<F extends Function> = FunctionCall<F> & {
    host?: HostInterface,
    path: Key[],
    keys: (number | Map<Key, number>)[],
    depth: number,
    id: number,
    by: number,
    key?: string | number,

    // Instance of F bound to self
    bound?: F,

    // State for user hooks
    state: any[] | null,
    pointer: number,

    // State for per-component memoization
    version: number | null,
    memo: number | null,

    // Last rendered return type
    type: ArrowFunction | null,

    // Mounting state
    mount: LiveFiber<any> | null,
    mounts: FiberMap | null,
    next: LiveFiber<any> | null,
    order: Key[] | null,
    lookup: Map<Key, number> | null,

    // User-specified context
    context: FiberContext,

    // Yeeting state
    yeeted: FiberYeet<any, any> | null,
    fork: boolean,

    // Quoting state
    quotes: FiberQuotes<any>,
    quote: FiberQuote<any> | null,
    unquote: FiberQuote<any> | null,

    // Count number of runs for inspector
    runs: number,

    __inspect?: Record<string, any> | null,
  };
  export type FiberMap = Map<Key, LiveFiber<any>>;
  // Fiber context mapping
  export type FiberContext = {
    values: ContextValues,
    roots: ContextRoots,
  };
  
  export type LiveEnvironment = LiveContext<any> | LiveCapture<any>;
  export type ContextValues = Map<LiveEnvironment, any>;
  export type ContextRoots = Map<LiveEnvironment, number | LiveFiber<any>>;
  
  // Fiber yeet state
  export type FiberYeet<A, B> = {
    id: number,
    emit: FiberSetter<A>,
    gather: FiberGather<B>,
    root: LiveFiber<any>,
    value?: A,
    reduced?: B,
    parent?: FiberYeet<A, B>,
    scope?: FiberYeet<any, any>,
  };
  
  // Fiber quote state
  export type FiberQuote<F extends ArrowFunction> = {
    root: number,
    from: number,
    to: LiveFiber<F>,
    reconciler?: LiveReconciler<any>,
  };
  
  export type FiberQuotes<F extends ArrowFunction> = Map<LiveReconciler<any>, FiberQuote<F>>;
  
  // Priority queue
  export type FiberQueue = {
    insert: (f: LiveFiber<any>) => void,
    remove: (f: LiveFiber<any>) => void,
    all: ()=> LiveFiber<any>[],
    peek: () => LiveFiber<any> | null,
    pop: () => LiveFiber<any> | null,
    reorder: (f: LiveFiber<any>) => void,
  };
  
  // Live host interface
  export type HostInterface = {
    // Schedule a task on next flush
    schedule: (fiber: LiveFiber<any>, task?: MaybeTask) => void,
    flush: () => void,
    
    // Track a future cleanup on a fiber
    track: (fiber: LiveFiber<any>, task: Task) => void,
    untrack: (fiber: LiveFiber<any>, task: Task) => void,
    
    // Dispose of a fiber by running all tracked cleanups
    dispose: (fiber: LiveFiber<any>) => void,
    
    // Track a long-range dependency for contexts
    depend: (fiber: LiveFiber<any>, root: number) => boolean,
    undepend: (fiber: LiveFiber<any>, root: number) => void,
    traceDown: (fiber: LiveFiber<any>) => LiveFiber<any>[],
    traceUp: (fiber: LiveFiber<any>) => number[],
    
    // Fiber update queue
    visit: (fiber: LiveFiber<any>) => void,
    unvisit: (fiber: LiveFiber<any>) => void,
    pop: () => LiveFiber<any> | null,
    peek: () => LiveFiber<any> | null,
    reorder: (fiber: LiveFiber<any>) => void,
    
    // Stack slicing
    depth: (d: number) => void,
    slice: (d: number) => boolean,
    
    // Id generator
    id: () => number,
    
    __stats: {mounts: number, unmounts: number, updates: number, dispatch: number},
    __ping: (fiber: LiveFiber<any>, active?: boolean) => void,
    __highlight: (id: number | null, active?: boolean) => void,
  };
/* END TYPES */  


/* UTILS */
const NOP = () => {};
const NO_DEPS = [] as any[];
const dedupe = <T>(list: T[]): T[] => Array.from(new Set<T>(list));

/** Cyclic 32-bit version number that skips 0 */
export const incrementVersion = (v: number) => (((v + 1) | 0) >>> 0) || 1;

type Action = {
  fiber: LiveFiber<any>,
  task?: MaybeTask,
};

/** Schedules actions to be run immediately after the current thread completes.
Notifies the bound listener once after running all actions. */
export const makeActionScheduler = (
  request: (flush: ArrowFunction) => void,
  onFlush: (fibers: LiveFiber<any>[]) => void,
) => {
  const queue = [] as Action[];

  let pending = false;

  const schedule = (fiber: LiveFiber<any>, task?: MaybeTask) => {
    queue.push({fiber, task});
    if (!pending) {
      pending = true;
      request(flush);
    }
  };

  const flush = () => {
    if (!queue.length) return;

    const q = queue.slice();
    queue.length = 0;
    pending = false;

    const acted = [];
    for (const {fiber, task} of q) if (task?.() !== false) acted.push(fiber);

    const fibers = dedupe(acted);
    if (fibers.length) onFlush(fibers);
  };

  return {schedule, flush};
}

/** Tracks long-range dependencies for contexts */
export const makeDependencyTracker = () => {
  // Used in forward direction
  const dependencies = new Map<number, Set<LiveFiber<any>>>();

  // Inspector-only, backward direction
  const precedents = new WeakMap<LiveFiber<any>, Set<number>>();

  const depend = (fiber: LiveFiber<any>, root: number) => {
    {
      let list = precedents.get(fiber);
      if (!list) precedents.set(fiber, list = new Set());

      const exist = list.has(root);
      if (!exist) list.add(root);
    }

    let list = dependencies.get(root);
    if (!list) dependencies.set(root, list = new Set());

    const exist = list.has(fiber);
    if (!exist) list.add(fiber);
    return !exist;
  }

  const undepend = (fiber: LiveFiber<any>, root: number) => {
    {
      const list = precedents.get(fiber);
      if (list) list.delete(root);
    }

    const list = dependencies.get(root);
    if (list) {
      list.delete(fiber);
      if (list.size === 0) dependencies.delete(root);
    }
  }

  const traceDown = (fiber: LiveFiber<any>) => {
    const fibers = dependencies.get(fiber.id);
    return fibers ? fibers.values() : NO_DEPS;
  }

  const traceUp = (fiber: LiveFiber<any>) => {
    const fibers = precedents.get(fiber);
    return fibers ? fibers.values() : NO_DEPS;
  }

  return {depend, undepend, traceDown, traceUp};
}


/** Schedules actions to be run when an object is disposed of */
export const makeDisposalTracker = () => {
  const disposal = new WeakMap<LiveFiber<any>, Task[]>();

  const track = (fiber: LiveFiber<any>, t: Task) => {
    let list = disposal.get(fiber);
    if (!list) disposal.set(fiber, list = []);
    list.push(t);
  }

  const untrack = (fiber: LiveFiber<any>, t: Task) => {
    const list = disposal.get(fiber);
    if (!list) return;

    const i = list.indexOf(t);
    list.splice(i, 1);
  }

  const dispose = (fiber: LiveFiber<any>) => {
    const tasks = disposal.get(fiber);
    if (tasks) {
      disposal.delete(fiber);
      for (const task of tasks) task();
    }
  }

  return {track, untrack, dispose};
}

/** Slice stack once depth has been exceeded */
export const makeStackSlicer = (maxDepth: number, strict: boolean = true) => {
  let DEPTH = 0;
  let SLICED = false;

  const depth = strict
    ? (depth: number) => {
        DEPTH = depth;
        SLICED = false;
      }
    : (depth: number) => {
        DEPTH = depth;
      };

  const slice = strict
    ? (depth: number) => { return SLICED = SLICED || (depth - DEPTH > maxDepth); }
    : (depth: number) => { return (depth - DEPTH > maxDepth); };

  return {depth, slice};
};

/** Node-friendly RAF wrapper */
export const getOnPaint = () => typeof window !== 'undefined' ? window.requestAnimationFrame : setTimeout;

/** Compare dependency arrays */
export const isSameDependencies = (
  prev: any[] | undefined,
  next: any[],
) => {
  if (prev === undefined) return false;
  if (next === prev) return true;

  const l = prev.length;
  if (l !== next.length) return false;
  for (let i = 0; i < l; ++i) if (prev[i] !== next[i]) return false;
  return true;
}

/** Check if B is a subnode of A */
export const isSubNode = (a: LiveFiber<any>, b: LiveFiber<any>) => {
  const ak = a.path;
  const bk = b.path;

  if (ak.length > bk.length) return false;
  if (a.depth >= b.depth) return false;

  const n = ak.length;
  for (let i = 0; i < n; ++i) if (ak[i] !== bk[i]) return false;

  return (bk.length > ak.length) || (b.depth > a.depth);
}

/** Compare of two fibers in depth-first tree order */
export const compareFibers = (a: LiveFiber<any>, b: LiveFiber<any>) => {
  const ap = a.path;
  const bp = b.path;

  const aks = a.keys;
  const bks = b.keys;

  let aj = aks ? aks[0] : null;
  let bj = bks ? bks[0] : null;
  let asi = 1;
  let bsi = 1;

  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; ++i) {
    let ai = ap[i];
    let bi = bp[i];

    if (aj === i) {
      const ak = aks[asi++] as Map<Key, number>;
      ai = ak.get(ai) ?? -1;
      aj = aks[asi++] as number;
    }

    if (bj === i) {
      const bk = bks[bsi++] as Map<Key, number>;
      bi = bk.get(bi) ?? -1;
      bj = bks[bsi++] as number;
    }

    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }

  return (ap.length - bp.length) || (a.depth - b.depth);
}

/** Tag an anonymous function with a random number ID. */
export const tagFunction = <F extends ArrowFunction>(f: F, name?: string) => {
  if ((f as any).displayName == null) (f as any).displayName = name ?? `${Math.floor(Math.random() * 10000)}`;
  return f;
}
/* END UTILS */

// effect.ts
  // export type Effect<S = unknown, E = never, R = never> = LiveComponent & {
  //   readonly _S?: S; readonly _E?: E; readonly _R?: R; // phantom
  // }

  // // Ok / Fail / Need (return-driven)
  // export const ok   = <S>(s: S): Effect<S, never, never> => ({} as any);
  // export const fail = <E>(e: E): Effect<never, E, never> => ({} as any);
  // export const need = <R>(r: R): Effect<never, never, R> => ({} as any);

  // // Runtime resolve/provide (replace with Rust later)
  // type Ctx = Map<Capability<any>, any>;
  // const ctxStack: Ctx[] = [new Map()];

  // export const provide = <T, A>(
  //   cap: Capability<T>, value: T, render: () => A
  // ): A => {
  //   const m = new Map(ctxStack[ctxStack.length - 1]);
  //   m.set(cap, value);
  //   ctxStack.push(m);
  //   try { return render(); } finally { ctxStack.pop(); }
  // };

  // export const resolve = <T>(cap: Capability<T>): T | undefined =>
  //   ctxStack[ctxStack.length - 1].get(cap);

  // // Multi
  // export const resolveCaps = <P extends readonly Capability<any>[]>(p: P) => {
  //   const m = ctxStack[ctxStack.length - 1];
  //   return {
  //     hasAll: p.every(c => m.has(c)),
  //     get<K>(c: Capability<K>): K { return m.get(c) }
  //   } as const;
  // };

  // // Running effects. Future concepts: runSyncExit (runSync just runs it and returns a result. runSyncExit can fail, or succeed.)
  // export const runSync = <S, E>(e: (args?: any) => Effect<S, E, never>): S => {
  //   const result = renderSync(e);
  //   // How TF is this supposed to return something? 
  //   // Critical: It returns S, which may be like a number, or just nothing at all.
  //   // Could be like an exist code. 
  //   // How does this work? Well, we allow the effect that's being ran to do a final yeet() all the way here.
  //   // LOL idk if this works.
  //   console.log(result.yeeted);
  //   return result.yeeted?.value;
  // }
  // More running effects - fun stuff like runPromise(), runPromiseExit(), and obviously just good ol' runFork()
  // runFork lets you interrupt and shit - you get the fiber directly, it's raw.
  // there's a TON more possibilities for ways to run effects: https://effect-ts.github.io/effect/effect/Effect.ts.html#running-effects


  // A lot of this stuff is gonna be just wrapping Live - for now

  // a ton of these new fancy operations like ok() err() and so on are just yeets !!! !!!! JUST FUCKING YEETS.


  // Capabilities that might depend on other capabilties. This is interesting. Concept of layer is helpful.
  // So first off, capabilities can get stored in a map - we can call that a context.
  // Now, we want metadata about what capabilities require other capabilities. 

/* tree.ts */
  const DEFAULT_RUN_OPTIONS = {
    stackSliceDepth: 20,
    strictQueueOrder: true,
    strictSliceOrder: true,
  };

  const START = +new Date();

  const NO_NODE = () => null;

  // Create new runtime host
  export const makeHost = (
    options: RunOptions = DEFAULT_RUN_OPTIONS,
    dispatch: (t: Task) => void,
    flush: (fs: LiveFiber<any>[]) => void,
  ) => {
    const {
      stackSliceDepth,
      strictQueueOrder,
      strictSliceOrder,
    } = {...DEFAULT_RUN_OPTIONS, ...options};

    const scheduler  = makeActionScheduler(dispatch, flush);
    const disposal   = makeDisposalTracker();
    const dependency = makeDependencyTracker();
    const queue      = makeFiberQueue();
    const slicer     = makeStackSlicer(stackSliceDepth, strictSliceOrder);

    let ID = 0;

    const host = {
      schedule: scheduler.schedule,
      flush: scheduler.flush,

      track: disposal.track,
      untrack: disposal.untrack,
      dispose: disposal.dispose,

      depend: dependency.depend,
      undepend: dependency.undepend,
      traceDown: dependency.traceDown,
      traceUp: dependency.traceUp,

      visit: queue.insert,
      unvisit: queue.remove,
      pop: queue.pop,
      peek: queue.peek,
      reorder: strictQueueOrder ? queue.reorder : () => {},
      all: queue.all,

      depth: slicer.depth,
      slice: slicer.slice,

      id: () => ++ID,
      options,

      __ping: () => {},
      __highlight: () => {},
      __stats: {mounts: 0, unmounts: 0, updates: 0, dispatch: 0},
    } as HostInterface;

    return {host, scheduler, disposal, dependency};
  }

  // Create top-most fiber with a new host
  export const makeHostFiber = (
    node: DeferredCall<any>,
    options: RunOptions = DEFAULT_RUN_OPTIONS,
    dispatch: (t: Task) => void,
    flush: (fibers: LiveFiber<any>[]) => void,
  ) => {
    const {host, scheduler, disposal, dependency} = makeHost(options, dispatch, flush);
    const fiber = makeFiber(node.f, host, null, node.args);
    return {fiber, host, scheduler, disposal, dependency};
  }

  // Resolve a LiveElement root to a call
  export const resolveRootNode = (children: LiveNode<any>): DeferredCall<any> => {
    const c = reactInterop(children);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (Array.isArray(c)) return morph(use(() => c))!;
    if (typeof c === 'string') return use(NO_NODE);
    if (typeof c === 'function') return use(c);
    return c ?? use(NO_NODE);
  }

  // Rendering entry point
  export const renderWithDispatch = (
    dispatch?: (t: Task) => void,
  ) => <F extends ArrowFunction>(
    calls: LiveNode<F>,
    fiber?: LiveFiber<any> | null,
    options: RunOptions = DEFAULT_RUN_OPTIONS,
  ) => {
    const LOG = LOGGING.dispatch;
    const node = resolveRootNode(calls);

    let host: HostInterface | null = null;
    if (!fiber) {
      LOG && console.log('Rendering Root', formatNode(node));

      // Set up batched flush for all actions
      const flush = (fibers: LiveFiber<any>[]) => {
        (LOG || LOGGING.tick) && console.log('----------------------------');
        LOG && console.log('Dispatch to Roots', fibers.map(formatNode), +new Date() - START, 'ms');
        // eslint-disable-next-line no-debugger
        if (!fibers.length) debugger;

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (fibers.length) renderFibers(host!, fibers);
      };

      // Make new root
      ({fiber, host} = makeHostFiber(node, options, dispatch ?? queueMicrotask, flush));

      host.__stats.mounts++;
    }
    else if (fiber.host) {
      host = fiber.host;

      if (fiber.f !== node.f) {
        // Dispose and return new root
        LOG && console.log('Replacing Root', formatNode(node));
        disposeFiber(fiber);
        fiber = makeFiber(node.f, host, null, node.args);
      }
      else {
        // Update existing root
        LOG && console.log('Updating Root', formatNode(node));
        fiber.args = node.args;
      }

      host.__stats.updates++;
    }

    if (host) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (dispatch) dispatch(() => renderFibers(host!, [fiber!]));
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      else renderFibers(host!, [fiber!]);
    }

    return fiber;
  }

  // Render a list of updated fibers as one batch
  export const renderFibers = (
    host: HostInterface,
    fibers: LiveFiber<any>[],
  ): LiveFiber<any>[] => {
    const LOG = LOGGING.dispatch;

    for (const f of fibers) host.visit(f);
    while (host.peek()) {
      const fiber = host.pop();
      if (!fiber) break;

      host.depth(fiber.depth);
      host.__stats.dispatch++;

      LOG && console.log(`Next Sub-Root #${fiber.id}`, formatNode(fiber));

      const element = renderFiber(fiber);
      updateFiber(fiber, element);
    }

    return fibers;
  }

  // Traverse over fiber and subfiber in render order
  export const traverseFiber = (fiber: LiveFiber<any>, f: (f: LiveFiber<any>) => void) => {
    const {mount, mounts, next} = fiber;
    if (mount) traverseFiber(mount, f);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (mounts) for (const k of mounts.keys()) traverseFiber(mounts.get(k)!, f);
    if (next) traverseFiber(next, f);
  }

  const onPaint = getOnPaint();

  // Render sync/async/onPaint
  export const renderSync = renderWithDispatch();
  export const renderAsync = renderWithDispatch((t: Task) => { setTimeout(t, 0); });
  export const renderOnPaint = renderWithDispatch((t: Task) => { onPaint(t); });

  export const render = renderSync;
  export const unmount = (fiber: LiveFiber<any>) => disposeFiber(fiber);

/* builtin.ts */

  /** @hidden */
  export const MORPH        = () => {};
  /** @hidden */
  export const DETACH       = () => {};
  /** @hidden */
  export const FRAGMENT     = () => {};
  /** @hidden */
  export const MAP_REDUCE   = () => {};
  /** @hidden */
  export const GATHER       = () => {};
  /** @hidden */
  export const MULTI_GATHER = () => {};
  /** @hidden */
  export const FENCE        = () => {};
  /** @hidden */
  export const YEET         = () => {};
  /** @hidden */
  export const PROVIDE      = () => {};
  /** @hidden */
  export const CAPTURE      = () => {};
  /** @hidden */
  export const DEBUG        = () => {};
  /** @hidden */
  export const SUSPEND      = () => {};
  /** @hidden */
  export const RECONCILE    = () => {};
  /** @hidden */
  export const QUOTE        = () => {};
  /** @hidden */
  export const UNQUOTE      = () => {};
  /** @hidden */
  export const SIGNAL       = () => {};

  (MORPH        as any).isLiveBuiltin = true;
  (DETACH       as any).isLiveBuiltin = true;
  (FRAGMENT     as any).isLiveBuiltin = true;
  (MAP_REDUCE   as any).isLiveBuiltin = true;
  (GATHER       as any).isLiveBuiltin = true;
  (MULTI_GATHER as any).isLiveBuiltin = true;
  (FENCE        as any).isLiveBuiltin = true;
  (YEET         as any).isLiveBuiltin = true;
  (PROVIDE      as any).isLiveBuiltin = true;
  (CAPTURE      as any).isLiveBuiltin = true;
  (DEBUG        as any).isLiveBuiltin = true;
  (SUSPEND      as any).isLiveBuiltin = true;
  (RECONCILE    as any).isLiveBuiltin = true;
  (QUOTE        as any).isLiveBuiltin = true;
  (UNQUOTE      as any).isLiveBuiltin = true;
  (SIGNAL       as any).isLiveBuiltin = true;

  (FRAGMENT     as any).isLiveInline = true;

  /** @hidden */
  export const EMPTY_FRAGMENT = {f: FRAGMENT, args: []};

  // Inline render ops
  type UseArgs<F> = F extends ArrowFunction ? Parameters<F> : any[];

  interface Use<F extends ArrowFunction> {
    (f: LiveFunction<F>): DeferredCall<F>;
    (f: LiveFunction<F>, ...args: UseArgs<F>): DeferredCall<F>;
  };

  /** Use a call to a Live function, reconciled by numeric index. */
  export const use: Use<any> = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    ...args: UseArgs<F>
  ): DeferredCall<F> => {
    if (!f) throw new Error("Invalid JSX component type");
    return ({f, args, key: undefined, by: getCurrentFiberID()} as any);
  };

  /** Use a keyed call to a Live function, reconciled by key. */
  export const keyed = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    key?: Key,
    ...args: UseArgs<F>
  ): DeferredCall<F> => ({f, args, key, by: getCurrentFiberID()} as any);

/** Use a call to a Live Component with only a children prop. */
export const wrap = <F extends ArrowFunction>(
  f: LiveFunction<F>,
  children: any,
): DeferredCall<F> => ({f, args: [{children}], key: undefined, by: getCurrentFiberID()} as any);

/** Add arguments to an existing call or calls. */
export const extend = (
  calls: LiveNode<any>,
  props: Record<string, any>,
): LiveElement => {
  if (typeof calls === 'string') throw new Error(`Cannot extend props of string child '${calls}'`);
  if (typeof calls === 'number') throw new Error(`Cannot extend props of number child '${calls}'`);
  if (typeof calls === 'function') throw new Error(`Cannot extend props of function child '${calls}'`);
  // Only treat `null`, `undefined` or boolean `false` as empty LiveElement here.
  if (calls == null || calls === false) return calls as LiveElement;

  if (Array.isArray(calls)) return calls.map(call => extend(call, props)) as any;
  if ('props' in calls) {
    return extend(keyed(calls.type, calls.key, calls.props), props);
  }
  else if (calls.args?.length) {
    const [existing, ...rest] = calls.args;
    return ({...calls, args: [{...existing, ...props}, ...rest] });
  }

  return ({...calls, args: [props] } as any);
}

/** Mutate arguments in-place on an existing call or calls. */
export const mutate = (
  calls: LiveNode<any>,
  props: Record<string, any>,
): LiveElement => {
  if (typeof calls === 'string') throw new Error(`Cannot extend props of string child '${calls}'`);
  if (typeof calls === 'number') throw new Error(`Cannot extend props of number child '${calls}'`);
  if (typeof calls === 'function') throw new Error(`Cannot extend props of function child '${calls}'`);
  if (!calls) return;

  if (Array.isArray(calls)) {
    calls.forEach(call => mutate(call, props)) as any;
  }
  else if ('props' in calls) {
    for (const k in props) calls.props[k] = props[k];
  }
  else if (calls.args?.length) {
    const ps = calls.args[0];
    for (const k in props) ps[k] = props[k];
  }
  else {
    calls.args = [props];
  }
}

/** Morph a call to a Live function.

Morphing will change a component's type, without forcibly unmounting its children.

Children are still reconciled as usual, and only stay if re-rendered by the new parent.

The parent that is being morphed still loses all its own state.
*/
export const morph = (
  calls: LiveNode<any>,
  key?: Key,
): DeferredCall<() => void> => ({f: MORPH, args: calls as any, key, by: getCurrentFiberID()} as any);

/** Detach the rendering of a Live subtree.

The callback is invoked with a render function, which it can call repeatedly to render the detached fiber. */
export const detach = <F extends ArrowFunction>(
  call: DeferredCall<F> | DeferredCall<F>[],
  callback: (run: () => void, fiber: LiveFiber<F>) => void,
  key?: Key,
): DeferredCall<() => void> => ({f: DETACH, args: [call, callback], key, by: getCurrentFiberID()} as any);

/** Holds an array of Live calls to reconcile. */
export const fragment = (
  calls: LiveNode<any>,
  key?: Key,
): LiveElement => {
  if (key !== null) {
    if (Array.isArray(calls)) return {f: FRAGMENT, args: calls, key};
    return calls != null ? {f: FRAGMENT, args: [calls], key} : null;
  }
  if (Array.isArray(calls)) return calls as any;
  return calls != null ? [calls] as any : null;
}

/** Wrap a fragment in a debug node to mark it. */
export const debug = (
  calls: LiveNode<any>,
  key?: Key,
): DeferredCall<() => void> => {
  if (Array.isArray(calls)) return ({f: DEBUG, args: calls, key, by: getCurrentFiberID()} as any);
  return ({f: DEBUG, args: [calls], key} as any);
}

/** Reduce values from a subtree, using the given `map(...)` and `reduce(...)`. */
export const mapReduce = <R, T>(
  calls?: LiveNode<any>,
  map?: (t: T) => R,
  reduce?: (a: R, b: R) => R,
  then?: LiveFunction<(r: R) => LiveElement>,
  fallback?: R,
  key?: Key,
): DeferredCall<() => void> => ({f: MAP_REDUCE, args: [calls, map, reduce, then, fallback], key, by: getCurrentFiberID()} as any);

/** Gather items from a subtree, into a flat array. */
export const gather = <T>(
  calls?: LiveNode<any>,
  then?: LiveFunction<(r: T[]) => LiveElement>,
  fallback?: T[],
  key?: Key,
): DeferredCall<() => void> => ({f: GATHER, args: [calls, then, fallback], key, by: getCurrentFiberID()} as any);

/** Multi-gather items from a subtree, by object key. */
export const multiGather = <T>(
  calls?: LiveNode<any>,
  then?: LiveFunction<(r: Record<string, T[]>) => LiveElement>,
  fallback?: Record<string, T[]>,
  key?: Key,
): DeferredCall<() => void> => ({f: MULTI_GATHER, args: [calls, then, fallback], key, by: getCurrentFiberID()} as any);

  /** Fence gathered items from a subtree. */
  export const fence = <T>(
    calls?: LiveNode<any>,
    then?: LiveFunction<(r: T) => LiveElement>,
    fallback?: T,
    key?: Key,
  ): DeferredCall<() => void> => ({f: FENCE, args: [calls, then, fallback], key, by: getCurrentFiberID()} as any);

  /** Yeet value(s) upstream. */
  export const yeet = <T>(
    value?: T,
    key?: Key,
  ): DeferredCall<() => void> => ({f: YEET, arg: value, key, by: getCurrentFiberID()} as any);

  /** Provide a value for a Live context. */
  export const provide = <C>(
    context: LiveContext<C>,
    value: C,
    calls?: LiveNode<any>,
    key?: Key,
  ): DeferredCall<() => void> => ({f: PROVIDE, args: [context, value, calls], key, by: getCurrentFiberID()} as any);

  /** Capture values from a Live context. */
  export const capture = <T, C>(
    context: LiveCapture<C>,
    calls?: LiveNode<any>,
    then?: LiveFunction<(r: T) => void>,
    key?: Key,
  ): DeferredCall<() => void> => ({f: CAPTURE, args: [context, calls, then], key, by: getCurrentFiberID()} as any);

  /** Reconcile quoted calls to a separate tree. */
  export const reconcileTo = <T>(
    reconciler: LiveReconciler<T>,
    calls?: LiveNode<any>,
    key?: Key,
  ): DeferredCall<() => void> => ({f: RECONCILE, args: [reconciler, calls], key, by: getCurrentFiberID()} as any);

  /** Quote a subtree and reconcile it into the given reconciler context. */
  export const quoteTo = <T>(
    reconciler: LiveReconciler<T>,
    calls?: LiveNode<any>,
    key?: Key,
  ): DeferredCall<() => void> => {
    if (!reconciler?.reconciler) throw new Error("Missing reconciler for quote");
    return ({f: QUOTE, args: [reconciler, calls], key, by: getCurrentFiberID()} as any);
  };

  /** Escape from quote. */
  export const unquote = (
    calls?: LiveNode<any>,
    key?: Key,
  ): DeferredCall<() => void> => ({f: UNQUOTE, args: calls, key, by: getCurrentFiberID()} as any);

  /** Signal = quote yeet an empty value */
  export const signalTo = <T>(reconciler: LiveReconciler<T>, key?: Key) => {
    if (!reconciler?.reconciler) throw new Error("Missing reconciler for signal");
    return ({f: SIGNAL, args: [reconciler], key, by: getCurrentFiberID()} as any);
  };

  /** Yeet a suspend symbol. */
  export const suspend = (key?: Key) => yeet(SUSPEND, key);

  /** LOL. Look, _you_ go try to make JSX.Element polymorphic. */
  export const into = (children: any): any => children;

  /** Make deprecated warning for component. */
  export const deprecated = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    oldName: string,
    newName?: string,
  ): LiveFunction<F> => {
    let warning = false;

    const wrapped = (props: any) => {
      if (!warning) {
        const unmemo = (s?: string) => s ? s.replace(/Memo\(([^)]+)\)/g, '$1') : null;

        console.warn(`<${oldName}> is deprecated. Use <${unmemo(newName) ?? (f as any).displayName ?? f.name}> instead.`);
        warning = true;
      }
      return f(props);
    };

    return new Proxy(wrapped, {
      get: (target, s) => {
        if (s === 'name') return oldName;
        return (target as any)[s];
      },
    }) as any;
  };

  export interface MakeContext {
    <T>(initialValue: T, displayName?: string): LiveContext<T>;
    <T>(initialValue: undefined, displayName?: string): LiveContext<T>;
    <T>(initialValue: null, displayName?: string): LiveContext<T | null>;
  };

  /** Make Live context for holding shared value for child nodes (defaulted, required or optional). */
  export const makeContext: MakeContext = <T>(initialValue?: T | null, displayName?: string) => ({
    initialValue,
    displayName,
    // Ensure this is the literal `true` type so it matches LiveContext.context?: true
    context: true as const,
  });

  /** Make Live capture for holding shared value for child nodes */
  export const makeCapture = <T>(displayName?: string): LiveCapture<T> => ({
    displayName,
    capture: true,
  });

  /** Make Live reconciler for incrementally rendering quoted child nodes */
  export const makeReconciler = <T>(displayName?: string): LiveReconciler<T> => {
    const self: LiveReconciler<T> = {
      displayName,
      reconciler: true,
      reconcile: (el: LiveElement): LiveElement => reconcileTo(self, el),
      quote: (el: LiveElement): LiveElement => quoteTo(self, el),
      signal: () => signalTo(self),
    };
    return self;
  };

  /** Tag a component as imperative, always re-rendered from above even if props/state didn't change (deprecated) */
  export const makeImperativeFunction = (
    component: LiveFunction<any>,
    displayName?: string,
  ): LiveFunction<any> => {
    (component as any).isImperativeFunction = true;
    tagFunction(component, displayName);
    return component;
  }

  /** Component has side-effects, and will re-render even if props object is identical. */
  export const imperative = makeImperativeFunction;

/* current.ts (mutable state) */
  // Hide the fiber argument like in React
  export let CURRENT_FIBER = null as LiveFiber<any> | null;
  export let CURRENT_FIBER_BY = null as number | null;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  export const getCurrentFiber = () => CURRENT_FIBER!;
  export const getCurrentFiberID = () => CURRENT_FIBER?.id;
  export const getCurrentFiberBy = () => CURRENT_FIBER_BY ?? CURRENT_FIBER?.id;
  export const setCurrentFiber = (f: LiveFiber<any> | null) => CURRENT_FIBER = f;
  export const setCurrentFiberBy = (id: number | null) => CURRENT_FIBER_BY = id;


/* fiber.ts (huge heavy lifting - it's the entire runtime) */

  let ID = 0;
  const EMPTY_ARRAY = [] as any[];
  const ROOT_PATH = [0] as Key[];
  const NO_QUOTES = new Map() as FiberQuotes<any>;
  const NO_CONTEXT = {
    values: new Map() as ContextValues,
    roots: new Map() as ContextRoots,
  };

  // Prepare to call a live function with optional given persistent fiber
  export const bind = <F extends ArrowFunction>(f: LiveFunction<F>, maybeFiber?: LiveFiber<F> | null, base: number = 0) => {
    const fiber = maybeFiber ?? makeFiber(f, null);

    const length = getArgCount(f);
    if (length === 0) {
      return () => {
        enterFiber(fiber, base);
        const value = f();
        exitFiber(fiber);
        return value;
      }
    }
    if (length === 1) {
      return (arg: any) => {
        enterFiber(fiber, base);
        const value = f(arg);
        exitFiber(fiber);
        return value;
      }
    }
    if (length === 2) {
      return (arg1: any, arg2: any) => {
        enterFiber(fiber, base);
        const value = f(arg1, arg2);
        exitFiber(fiber);
        return value;
      }
    }
    return (...args: any[]) => {
      enterFiber(fiber, base);
      // eslint-disable-next-line prefer-spread
      const value = f.apply(null, args);
      exitFiber(fiber);
      return value;
    }
  };

  // Enter/exit a fiber call
  export const enterFiber = <F extends ArrowFunction>(fiber: LiveFiber<F>, base: number) => {
    setCurrentFiber(fiber);

    // Reset state pointer
    fiber.pointer = base;
  }

  export const exitFiber = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    discardState(fiber);
    setCurrentFiber(null);
  }

  // Make a fiber for a live function
  export const makeFiber = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    host?: HostInterface | null,
    parent?: LiveFiber<any> | null,
    args?: any[],
    by: number = parent?.id ?? 0,
    key?: Key,
    keyed?: boolean,
  ): LiveFiber<F> => {
    const bound = null as any;
    const depth = parent ? parent.depth + 1 : 0;

    const id = host?.id() ?? ++ID;

    const yeeted  = parent?.yeeted ? {...parent.yeeted, id, parent: parent.yeeted, value: undefined, reduced: undefined, scope: null} : null;
    const quotes  = parent?.quotes ?? NO_QUOTES;
    const unquote = parent?.unquote ?? null;
    const context = parent?.context ?? NO_CONTEXT;

    let path = parent ? parent.path : ROOT_PATH;
    let keys = parent ? parent.keys : null;
    if (keyed && parent) {
      keys = [...(keys ?? EMPTY_ARRAY), path.length, parent.lookup];
    }
    if (key != null) path = [...path, key];

    const self = {
      f, args, bound, host,
      depth, path, keys,
      yeeted, quotes, quote: null, unquote, context,
      state: null, pointer: 0, version: null, memo: null, runs: 0,
      mount: null, mounts: null, next: null, order: null, lookup: null,
      type: null, id, by, key,
    } as LiveFiber<F>;

    self.bound = bind(f, self) as any as F;

    return self;
  };

  // Prepare a new sub fiber for continued rendering
  export const makeSubFiber = <F extends ArrowFunction>(
    parent: LiveFiber<any>,
    node: DeferredCall<F>,
    by: number = node.by ?? parent.id,
    key?: Key,
    keyed?: boolean,
  ): LiveFiber<F> => {
    const {host} = parent;
    const fiber = makeFiber(
      node.f,
      host,
      parent,
      node.args ?? (node.arg !== undefined ? [node.arg] : undefined),
      by,
      key,
      keyed,
    ) as LiveFiber<F>;
    return fiber;
  }

  // Make a named continuation for a fiber
  export const makeNextFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    Next: LiveFunction<any>,
    key?: Key,
    prefix: string = 'Next',
    reyeet?: boolean,
    name?: string,
  ): LiveFiber<any> => {

    const n = formatNodeName(fiber);
    name = name ?? (n.match(/^[A-Za-z]+\(/) ? n.slice(n.indexOf('(') + 1, -1) : n);
    if (name === prefix) name = '…';
    Next.displayName = `${prefix}(${name})`;

    const nextFiber = makeSubFiber(fiber, use(Next), fiber.id, 1); // path hardcoded to 1 to go second
    (nextFiber.f as any).isLiveContinuation = (fiber.f as any).isLiveBuiltin;
    nextFiber.key = key; // key set to allow remounting

    // Adopt existing yeet context
    // which will be overwritten on the original fiber.
    if (reyeet && fiber.yeeted) {
      nextFiber.yeeted = fiber.yeeted;
      nextFiber.yeeted.id = nextFiber.id;
    }

    return nextFiber;
  }

  // Make fiber yeet state
  export const makeYeetState = <F extends ArrowFunction, A, B, C>(
    fiber: LiveFiber<F>,
    nextFiber: LiveFiber<F>,
    gather: (f: LiveFiber<F>, self?: boolean) => C,
    map?: (a: A) => B,
  ): FiberYeet<any, C> => ({
    id: fiber.id,
    emit: map
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ? (fiber: LiveFiber<any>, v: A) => fiber.yeeted!.reduced = map(fiber.yeeted!.value = v)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      : (fiber: LiveFiber<any>, v: B) => fiber.yeeted!.value = fiber.yeeted!.reduced = v,
    gather,
    value: undefined,
    reduced: undefined,
    parent: undefined,
    root: nextFiber,
    scope: fiber.yeeted ?? undefined,
  });

  // Make fiber quote state
  export const makeQuoteState = <F extends ArrowFunction, T>(
    root: number,
    from: LiveFiber<F>,
    to: LiveFiber<F>,
    reconciler?: LiveReconciler<T>,
  ): FiberQuote<any> => ({
    root,
    from: from.id,
    to,
    reconciler,
  });

  // Make fiber context state
  export const makeContextState = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    parent: FiberContext,
    root: LiveFiber<F> | number,
    context: LiveContext<any>,
    value: any,
  ): FiberContext => {
    const values = new Map(parent.values);
    const roots = new Map(parent.roots);
    roots.set(context, root);
    values.set(context, { current: value, memo: null, displayName: context.displayName });

    return {values, roots};
  };

  // Render a fiber
  export const renderFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    const {f, host} = fiber;
    host?.unvisit(fiber);

    // These built-ins are explicitly mounted as sub-fibers,
    // so as to not collide with the parent state.
    if      ((f as any) === PROVIDE)   return provideFiber(fiber);
    else if ((f as any) === CAPTURE)   return captureFiber(fiber);
    else if ((f as any) === RECONCILE) return reconcileFiber(fiber);
    else if ((f as any) === DETACH)    return detachFiber(fiber);

    const LOG = LOGGING.render;
    LOG && console.log('Rendering', formatNode(fiber));

    const {bound, args} = fiber;
    let element: LiveElement;

    // Disposed fiber, ignore
    if (!bound) return;

    // Passthrough built-ins as rendered result
    if ((f as any).isLiveBuiltin) {
      // Fiber is shape-compatible
      element = fiber as any as LiveElement;
      // Enter/exit to clear state
      bound();
    }
    // Render live function
    // eslint-disable-next-line prefer-spread
    else element = bound.apply(null, args ?? EMPTY_ARRAY);
    if (typeof element === 'string') throw new Error(`Component may not return a string (${element})`);

    // Early exit if memoized and same result
    if (fiber.version != null) {
      if (fiber.version !== fiber.memo) {
        fiber.memo = fiber.version;
      }
      else return;
    }

    bustFiberDeps(fiber);

    // Apply rendered result
    return element ?? null;
  }

  // Ping a fiber in dev tool
  export const pingFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    active: boolean = true,
  ) => {
    // Notify host / dev tool of update
    const {host} = fiber;
    if (host?.__ping) host.__ping(fiber, active);
    if (active) pingFiberCount(fiber);
  }

  const BY_MAP = new WeakMap<any, number>();

  /** React element interop
      @hidden */
  export const reactInterop = (element: any, fiber?: LiveFiber<any>): DeferredCall<any> | DeferredCall<any>[] | null => {
    if (typeof element === 'string') throw new Error(`String "${element}" is not a valid JSX element`);
    let call = element as DeferredCall<any> | DeferredCall<any>[] | null;
    if (element && ('props' in element)) {
      // eslint-disable-next-line prefer-const
      let {type, key} = element;
      const by = BY_MAP.get(element) ?? fiber?.id;
      const props = {...element.props, key};
      if (typeof type === 'symbol') type = FRAGMENT;

      if (by != null) {
        const {children} = props;
        if (children) {
          if (Array.isArray(children)) children.forEach((c: any) => c && typeof c !== 'string' ? BY_MAP.set(c, by) : null);
          else if (typeof children === 'object' && 'props' in children) BY_MAP.set(props.children, by);
        }

        setCurrentFiberBy(by);
        call = createElement(type, props);
        // Unwrap single element fragments
        if (call && 'props' in call) call = reactInterop(call, fiber);
        setCurrentFiberBy(null);
      }
      else {
        call = createElement(type, props);
      }
    }
    return call ?? null;
  };

  // Update a fiber with rendered result
  export const updateFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    element: LiveElement | undefined | void,
  ) => {
    if (element === undefined) return;

    const {f, yeeted} = fiber;

    // Handle call and call[]
    element = reactInterop(element, fiber);
    const call = element as DeferredCall<any> | null;

    const isArray = !!element && Array.isArray(element);
    const fiberType = isArray ? Array : call?.f;

    // If morphing, do before noticing type change
    if (fiberType === MORPH) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let e = call!.args;
      e = reactInterop(e, fiber) as any;

      const c = e as any as DeferredCall<any>;
      const cs = e as any as DeferredCall<any>[];

      const isArray = !!e && Array.isArray(e);
      fiber.type = fiberType as any;

      if (isArray) reconcileFiberCalls(fiber, cs.map(call => morph(call as any)));
      else morphFiberCall(fiber, c);

      pingFiber(fiber);
      return;
    }

    const callArgs = call?.args ?? EMPTY_ARRAY;
    const callKey = call?.key;

    // If fiber type changed, remount everything
    if (fiber.next && callKey != null && fiber.next.key !== callKey) disposeFiberState(fiber);
    else if (fiber.type && fiber.type !== fiberType) disposeFiberState(fiber);
    fiber.type = fiberType as any;

    // Reconcile literal array
    if (isArray) {
      const calls = element as LiveElement[];
      reconcileFiberCalls(fiber, calls);
    }
    // Reconcile wrapped array fragment
    else if (fiberType === FRAGMENT || ((f as any) === DEBUG_BUILTIN)) {
      const calls = callArgs;
      if (Array.isArray(calls)) reconcileFiberCalls(fiber, calls);
      else mountFiberCall(fiber, calls as DeferredCall<any>);
    }
    // Map reduce
    else if (fiberType === MAP_REDUCE) {
      const [calls, map, reduce, then, fallback] = callArgs;
      mapReduceFiberCalls(fiber, calls, map, reduce, then, fallback, callKey);
    }
    // Gather reduce
    else if (fiberType === GATHER) {
      const [calls, then, fallback] = callArgs;
      gatherFiberCalls(fiber, calls, then, fallback, callKey);
    }
    // Multi-gather reduce
    else if (fiberType === MULTI_GATHER) {
      const [calls, then, fallback] = callArgs;
      multiGatherFiberCalls(fiber, calls, then, fallback, callKey);
    }
    // Fence gathered reduction
    else if (fiberType === FENCE) {
      const [calls, then, fallback] = callArgs;
      fenceFiberCalls(fiber, calls, then, fallback, callKey);
    }
    // Signal quoted reduction directly
    else if (fiberType === SIGNAL) {
      const [reconciler] = callArgs;
      const quote = fiber.quotes.get(reconciler);
      if (!quote) throw new Error(`Signal to reconciler ${reconciler.displayName} without being provided in ${formatNode(fiber)}`);
      if (!fiber.quote) fiber.quote = quote;
      visitYeetRoot(quote.to, true);
    }
    // Enter quoted calls
    else if (fiberType === QUOTE) {
      const [reconciler, calls] = callArgs;
      mountFiberQuote(fiber, reconciler, calls);
    }
    // Escape from quoted calls
    else if (fiberType === UNQUOTE) {
      const calls = callArgs;
      mountFiberUnquote(fiber, calls);
    }
    // Yeet value upstream
    else if (fiberType === YEET) {
      if (!yeeted) throw new Error("Yeet without aggregator in " + formatNode(fiber));

      const value = call ? (call.arg !== undefined ? call.arg : call.args?.[0]) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (value === undefined || (fiber.yeeted!.value !== value)) {
        bustFiberYeet(fiber);
        visitYeetRoot(fiber);

        if (value !== undefined) yeeted.emit(fiber, value);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        else fiber.yeeted!.value = undefined;
      }
      else if (fiber.f === YEET) {
        // Built-in ran but no new value, so don't ping
        return;
      }
    }
    // Mount normal node (may still be built-in)
    else {
      mountFiberCall(fiber, call);
    }

    pingFiber(fiber);
    return;
  }

  // Mount one call on a fiber
  export const mountFiberCall = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    call?: DeferredCall<any> | null,
    fenced?: boolean,
  ) => {
    const {mount, mounts} = fiber;
    if (mounts) disposeFiberMounts(fiber);

    const nextMount = updateMount(fiber, mount, call);
    if (nextMount !== false) {
      fiber.mount = nextMount;
      flushMount(nextMount, mount, fenced);
    }
  }

  // Mount a continuation on a fiber
  export const mountFiberContinuation = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    call: DeferredCall<any> | null,
    key: Key = 1,
  ) => {
    const {next} = fiber;

    const nextMount = updateMount(fiber, next, call, key);
    if (nextMount !== false) {
      fiber.next = nextMount;
      flushMount(nextMount, next, true);
    }
  }

  // Reconcile one call on a fiber as part of an incremental mapped set (reconcile/quote)
  export const reconcileFiberCall = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    call: DeferredCall<any> | null | undefined,
    key: Key,
    fenced?: boolean,
    path?: Key[],
    keys?: (number | Map<Key, number>)[],
    depth?: number,
  ) => {
    const {mounts, order, lookup, host, next} = fiber;
    if (!mounts || !order || !lookup || !next) throw new Error('Cannot reconcile incrementally on uninitialized mounts');

    call = reactInterop(call, fiber) as DeferredCall<any> | null;
    if (Array.isArray(call)) call = {f: FRAGMENT, args: call} as any;

    const empty = !mounts.size;
    const mount = mounts.get(key);
    const nextMount = updateMount(fiber, mount, call as any, key);

    if (nextMount !== false) {
      if (nextMount) {
        if (nextMount !== mount) {
          if (path != null) nextMount.path = path;
          if (keys != null) nextMount.keys = keys;
          if (depth != null) nextMount.depth = depth;

          pingFiber(fiber, false);
          mounts.set(key, nextMount);

          // If new mount, need to re-order keys
          if (!mount && (order.length || empty)) {
            order.length = 0;

            const LOG = LOGGING.quote;
            LOG && console.log("Re-order quote", formatNode(next), 'by', formatNode(fiber));
            if (host) host.visit(next);
          }
        }
      }
      else {
        if (nextMount !== mount) {
          mounts.delete(key);
          order.splice(order.indexOf(key), 1);
        }
      }

      flushMount(nextMount, mount, fenced);
    }
  }

  // Reconcile multiple calls on a fiber (normal children)
  export const reconcileFiberCalls = (() => {
    const seen = new Set<Key>();

    return <F extends ArrowFunction>(
      fiber: LiveFiber<F>,
      calls: LiveElement[],
      fenced?: boolean,
    ) => {
      // eslint-disable-next-line prefer-const
      let {mount, mounts, order, lookup} = fiber;
      if (mount) disposeFiberMounts(fiber);

      if (!mounts) mounts = fiber.mounts = new Map();
      if (!order)  order  = fiber.order  = [];

      if (!Array.isArray(calls)) calls = [calls];

      seen.clear();

      // Get new key set and order
      let i = 0, j = 0;
      let keyed = false;
      let rekeyed = false;
      for (const call of calls) {
        if (call == null || (call as any) === false) {
          j++;
          continue;
        }
        const callKey = (call as any)?.key;

        let key;
        if (callKey != null) {
          keyed = true;
          rekeyed = rekeyed || (order[i] !== callKey);
          key = callKey;
        }
        else {
          key = j++;
        }
        if (seen.has(key)) throw new Error(`Duplicate key '${key}' while reconciling ${formatNode(fiber)}`);

        seen.add(key);
        order[i++] = key;
      }
      order.length = i;

      if (rekeyed) {
        // Keyed fibers maintain a key lookup
        if (!lookup) lookup = fiber.lookup = new Map();
        for (let i = 0, n = order.length; i < n; ++i) {
          const o = order[i];
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          if (o != null) lookup!.set(o, i);
        }
      }

      // Unmount missing keys
      for (const key of mounts.keys()) if (!seen.has(key)) {
        const mount = mounts.get(key);
        mounts.delete(key);
        lookup?.delete(key);

        updateMount(fiber, mount, null);
        flushMount(null, mount, fenced);
      }

      // If rekeyed, reorder queue and invalidate yeeted/quoted order
      if (rekeyed) {
        const LOG = LOGGING.quote || LOGGING.render;
        LOG && console.log(`Rekeying ${fiber.id} ${formatNode(fiber)}`, '->', order);
        fiber.host?.reorder(fiber);
        bustFiberQuote(fiber);
        bustFiberYeet(fiber, true);
        visitYeetRoot(fiber, true);
      }

      // Mount new / updated keys
      for (let i = 0, j = 0, n = calls.length; i < n; ++i) {
        let call = calls[i];
        if (call == null || (call as any) === false) continue;

        const key = order[j++];
        call = reactInterop(call, fiber);

        // Array shorthand for nested reconciling
        if (Array.isArray(call)) call = {f: FRAGMENT, args: call} as any;

        const mount = mounts.get(key);
        const nextMount = updateMount(fiber, mount, call as any, key, keyed);
        if (nextMount !== false) {
          if (nextMount) mounts.set(key, nextMount);
          else mounts.delete(key);
          flushMount(nextMount, mount, fenced);
        }
      }
    }
  })();

  // Re-order child fibers by path, used across quotes to keep both tree shapes the same
  export const reconcileFiberOrder = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    const {order, mounts, lookup} = fiber;
    if (!order || !mounts || !lookup) throw new Error("Incremental fiber should be pre-initialized");

    // Re-order child keys
    order.length = 0;
    for (const k of mounts.keys()) order.push(k);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    order.sort((a, b) => compareFibers(mounts.get(a)!, mounts.get(b)!));

    // See if order changed
    let same = true;
    for (let i = 0, n = order.length; i < n; ++i) if (lookup.get(order[i]) !== i) {
      same = false;
      break;
    }
    if (same) {
      const LOG = LOGGING.quote;
      LOG && console.log(`Quote order unchanged ${fiber.id}`, formatNode(fiber), order);
      return;
    }

    const LOG = LOGGING.quote;
    LOG && console.log(`Re-ordered quote ${fiber.id}`, formatNode(fiber), order);

    lookup.clear();
    for (let i = 0, n = order.length; i < n; ++i) lookup.set(order[i], i);

    // Reorder queue and invalidate yeeted/quoted order
    fiber.host?.reorder(fiber);
    bustFiberQuote(fiber);
    bustFiberYeet(fiber, true);
    visitYeetRoot(fiber, true);
  }

  // Make a reconciling tail for a fiber. Used to fix order in case of rekeying.
  export const makeResolveFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    key?: Key,
    name: string = 'Resolve',
  ) => {
    // Incrementally reconciled. Pre-initialize these.
    const {mounts, lookup, order} = fiber;
    if (!mounts) fiber.mounts = new Map();
    if (!lookup) fiber.lookup = new Map();
    if (!order)  fiber.order  = [];

    const Resume = () => {
      reconcileFiberOrder(fiber);
    };

    return makeNextFiber(fiber, Resume, 1, name);
  }

  const toArray = <T>(x: T | T[] | undefined): T[] => Array.isArray(x) ? x : x != null ? [x] : [];
  const NO_ARRAY: any[] = [];
  const NO_RECORD: Record<string, any> = {};

  // Map-reduce a fiber
  export const mapReduceFiberCalls = <F extends ArrowFunction, R, T>(
    fiber: LiveFiber<F>,
    calls: LiveElement,
    mapper: (t: T) => R,
    reducer: (a: R, b: R) => R,
    next?: LiveFunction<any>,
    fallback?: R | typeof SUSPEND,
    key?: Key,
  ) => {
    const gather = reduceFiberValues(reducer);
    return mountFiberReduction(fiber, calls, mapper, gather, next, fallback, key);
  }

  // Gather-reduce a fiber
  export const gatherFiberCalls = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    calls: LiveElement,
    next?: LiveFunction<any>,
    fallback: (T[] | typeof SUSPEND) = NO_ARRAY,
    key?: Key,
  ) => {
    return mountFiberReduction(fiber, calls, undefined, gatherFiberValues, next, fallback, key);
  }

  // Multi-gather-reduce a fiber
  export const multiGatherFiberCalls = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    calls: LiveElement,
    next?: LiveFunction<any>,
    fallback: (Record<string, T[]> | typeof SUSPEND) = NO_RECORD,
    key?: Key,
  ) => {
    return mountFiberReduction(fiber, calls, undefined, multiGatherFiberValues, next, fallback, key);
  }

  // Fence a fiber reduction
  export const fenceFiberCalls = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    calls: LiveElement,
    next?: LiveFunction<any>,
    fallback?: T | typeof SUSPEND,
    key?: Key,
  ) => {
    const {yeeted} = fiber;
    const gather = yeeted?.gather ?? NOP;
    return mountFiberReduction(fiber, calls, undefined, gather, next, fallback, key);
  }

  // Reduce yeeted values on a tree of fibers (values have already been mapped on emit)
  export const reduceFiberValues = <R>(
    reducer: (a: R, b: R) => R,
  ) => {
    const reduce = <F extends ArrowFunction>(
      fiber: LiveFiber<F>,
      self: boolean = false,
    ): R | typeof SUSPEND | undefined => {
      const {yeeted, mount, mounts, order} = fiber;
      if (!yeeted) throw new Error("Reduce without aggregator");

      const isFork = fiber.fork;
      if (!self) {
        if (fiber.next && !isFork) return reduce(fiber.next);
      }

      if (yeeted.reduced !== undefined) return yeeted.reduced;
      if (mounts && order) {
        if (mounts.size) {
          const n = mounts.size;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const first = mounts.get(order[0])!;
          let value = reduce(first);
          if (value === SUSPEND) return yeeted.reduced = SUSPEND;

          if (n > 1) for (let i = 1; i < n; ++i) {
            const m = mounts.get(order[i]);
            if (!m) continue;

            const v = reduce(m);
            if (v === SUSPEND) return yeeted.reduced = SUSPEND;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            value = reducer((value as R), (v as R)!);
          }

          let reduced = value as any;
          if (isFork) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const fork = reduce(fiber.next!);
            if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

            reduced = (reduced && fork) ? reducer(reduced, fork as any) : (reduced ?? fork);
          }
          return yeeted.reduced = reduced;
        }
      }
      else if (mount) {
        const value = reduce(mount);
        if (value === SUSPEND) return yeeted.reduced = SUSPEND;

        let reduced = value as any;
        if (isFork) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const fork = reduce(fiber.next!);
          if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

          reduced = reduced && fork ? reducer(reduced, fork as any) : (reduced ?? fork);
        }
        return yeeted.reduced = reduced;
      }
      else if (isFork) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return yeeted.reduced = reduce(fiber.next!);
      }
      return undefined;
    };

    return reduce;
  }

  // Gather yeeted values on a tree of fibers
  // (recursive flatMap with array wrapper at leafs)
  export const gatherFiberValues = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    self: boolean = false,
  ): T | T[] | typeof SUSPEND | undefined => {
    const {yeeted, mount, mounts, order} = fiber;
    if (!yeeted) throw new Error("Reduce without aggregator");

    const isFork = fiber.fork;
    if (!self) {
      if (fiber.next && !isFork) return gatherFiberValues(fiber.next);
    }

    if (yeeted.reduced !== undefined) return yeeted.reduced;
    if (mounts && order) {
      if (mounts.size) {
        const items = [] as T[];
        for (const k of order) {
          const m = mounts.get(k);
          if (!m) continue;

          const value = gatherFiberValues(m);
          if (value === SUSPEND) return yeeted.reduced = SUSPEND;

          if (Array.isArray(value)) {
            const n = value.length;
            for (let i = 0; i < n; ++i) items.push(value[i] as T);
          }
          else items.push(value as T);
        }

        if (isFork) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const fork = gatherFiberValues(fiber.next!);
          if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

          if (fork) items.push(...toArray<T>(fork as any));
        }
        return yeeted.reduced = items;
      }
    }
    else if (mount) {
      const value = gatherFiberValues(mount);
      if (value === SUSPEND) return yeeted.reduced = SUSPEND;

      if (isFork) {
        const reduced = value ? toArray<T>(value as T | T[]).slice() : [];
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fork = gatherFiberValues(fiber.next!);
        if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

        reduced.push(...toArray<T>(fork as any));
        return yeeted.reduced = reduced;
      }

      if (self) return yeeted.reduced = toArray<T>(value as T | T[]);
      return yeeted.reduced = value as T | T[];
    }
    else if (isFork) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return yeeted.reduced = gatherFiberValues(fiber.next!);
    }
    return [];
  }

  // Multigather yeeted values on a tree of fibers
  // (recursive key-wise flatMap with optional array wrapper at leafs)
  export const multiGatherFiberValues = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    self: boolean = false,
  ): Record<string, T | T[]> | typeof SUSPEND => {

    const {yeeted, mount, mounts, order} = fiber;
    if (!yeeted) throw new Error("Reduce without aggregator");

    const isFork = fiber.fork;
    if (!self) {
      if (fiber.next && !isFork) return multiGatherFiberValues(fiber.next) as any;
    }

    if (yeeted.reduced !== undefined) return yeeted.reduced;
    if (mounts && order) {
      if (mounts.size) {
        const out = {} as Record<string, T[]>;

        for (const k of order) {
          const m = mounts.get(k);
          if (!m) continue;

          const value = multiGatherFiberValues(m);
          if (value === SUSPEND) return yeeted.reduced = SUSPEND;

          multiGatherMergeInto(out, value as any);
        }

        if (isFork) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const fork = multiGatherFiberValues(fiber.next!);
          if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

          multiGatherMergeInto(out, fork as any);
        }

        return yeeted.reduced = out;
      }
    }
    else if (mount) {
      let out = multiGatherFiberValues(mount);
      if (out === SUSPEND) return yeeted.reduced = SUSPEND;
      if (out != null && (self || isFork)) for (const k in (out as any)) (out as any)[k] = toArray((out as any)[k]);

      if (isFork) {
        out = {...out};
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fork = multiGatherFiberValues(fiber.next!);
        if (fork === SUSPEND) return yeeted.reduced = SUSPEND;

        multiGatherMergeInto(out as any, fork as any);
      }

      return yeeted.reduced = out as any;
    }
    else if (isFork) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return multiGatherFiberValues(fiber.next!);
    }
    return {} as Record<string, T | T[]>;
  }

  const multiGatherMergeInto = <T>(a: Record<string, T[]>, b: Record<string, T | T[]>) => {
    for (const k in b as Record<string, T | T[]>) {
      const v = (b as Record<string, T | T[]>)[k];
      let list = a[k] as T[];
      if (!list) list = a[k] = [];

      if (Array.isArray(v)) {
        const n = v.length;
        for (let i = 0; i < n; ++i) list.push(v[i] as T);
      }
      else if (v !== undefined) list.push(v as T);
    }
  }
  // Generalized mounting of reduction-like continuations
  export const mountFiberReduction = <F extends ArrowFunction, R, T>(
    fiber: LiveFiber<F>,
    calls: LiveElement[] | LiveElement,
    mapper: ((t: T) => R) | undefined,
    gather: FiberGather<R>,
    Next?: LiveFunction<any>,
    fallback?: R,
    key?: Key,
  ) => {
    if (!fiber.next) {
      const Resume = makeFiberReduction(fiber, gather, fallback);
      fiber.next = makeNextFiber(fiber, Resume, key, 'Resume', true);
      fiber.yeeted = makeYeetState(fiber, fiber.next, gather, mapper);
      fiber.path = [...fiber.path, 0];
    }

    calls = reactInterop(calls, fiber) as any;

    if (Array.isArray(calls)) reconcileFiberCalls(fiber, calls);
    else mountFiberCall(fiber, calls as any);

    mountFiberContinuation(fiber, use(fiber.next.f, Next));
  }

  // Wrap a live function to act as a reduction continuation of a prior fiber
  export const makeFiberReduction = <F extends ArrowFunction, R>(
    fiber: LiveFiber<F>,
    gather: FiberGather<R | typeof SUSPEND>,
    fallback?: R,
  ) => (
    then?: LiveFunction<any>
  ) => {
    const {next} = fiber;
    if (!next) return null;
    if (!then) return null;

    const LOG = LOGGING.render;
    LOG && console.log('Reducing', formatNode(fiber));

    const ref = useOne(() => ({current: fallback}));
    const value = gather(fiber, true);
    const nextValue = (value === SUSPEND)
      ? ref.current as any
      : ref.current = (value as R);

    return then(nextValue);
  };

  // Mount quoted calls on a fiber's continuation
  export const mountFiberQuote = <F extends ArrowFunction, T>(
    fiber: LiveFiber<F>,
    reconciler: LiveReconciler<T>,
    calls: LiveElement | LiveElement[],
  ) => {
    const {quotes} = fiber;
    const quote = quotes.get(reconciler);
    if (!quote) throw new Error(`Reconciler '${reconciler.displayName}' was used without being provided in ${formatNode(fiber)}`);

    const {id} = fiber;
    // eslint-disable-next-line prefer-const
    let {root, to, to: {next}} = quote;

    if (!next) {
      next = to.next = makeResolveFiber(to);
      next.unquote = null;
      to.fork = true;

      if (quote.root === quote.from) next.f.isLiveReconcile = true;
      else next.f.isLiveQuote = true;
    }

    pingFiber(to, false);

    const call = Array.isArray(calls) ? fragment(calls) : calls ?? EMPTY_FRAGMENT;
    reconcileFiberCall(to, call as any, id, true, fiber.path, fiber.keys, fiber.depth + 1);
    fiber.quote = quote;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const mount = to.mounts!.get(id);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (mount!.unquote?.to !== fiber) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      mount!.unquote = makeQuoteState(root, to, fiber, reconciler);
    }
  }

  // Mount unquoted calls on a fiber's origin
  export const mountFiberUnquote = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    calls: LiveElement | LiveElement[],
  ) => {
    if (!fiber.unquote) throw new Error(`Can't unquote outside of quote in ${formatNode(fiber)}`);

    const {id, unquote} = fiber;
    // eslint-disable-next-line prefer-const
    let {root, to, to: {next}, reconciler} = unquote;

    if (!next) {
      next = to.next = makeResolveFiber(to);
      next.unquote = null;
      to.fork = true;

      next.f.isLiveQuote = true;
    }

    pingFiber(to, false);

    const call = Array.isArray(calls) ? fragment(calls) : calls ?? EMPTY_FRAGMENT;
    reconcileFiberCall(to, call as any, id, true, fiber.path, fiber.keys, fiber.depth + 1);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const mount = to.mounts!.get(id)!;
    const {quotes} = mount;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (quotes.get(reconciler!)?.to !== fiber) {
      const quote = makeQuoteState(root, to, fiber);
      mount.quotes = new Map(mount.quotes);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      mount.quotes.set(reconciler!, quote);
    }
  }

  // Morph one call on a fiber
  export const morphFiberCall = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    call?: DeferredCall<any> | null,
  ) => {
    const {mount} = fiber;

    if (call && mount && (mount.f !== call.f) && !(call.f.isLiveBuiltin)) {
      if (
        mount.context === fiber.context &&
        !mount.next &&
        (!mount.quote) &&
        (!mount.unquote || mount.unquote.to !== mount)
      ) {
        // Discard all fiber state
        enterFiber(mount, 0);
        exitFiber(mount);
        bustFiberYeet(mount, true);
        visitYeetRoot(mount, true);

        // Change type in place while keeping existing mounts
        mount.type = null;
        mount.f = call.f;
        mount.bound = bind(call.f, mount);
        mount.args = undefined;
        mount.memo = null;
        mount.version = null;
      }
    }

    mountFiberCall(fiber, call);
  }

  // Inline a call to a fiber after a built-in (only fragments)
  export const inlineFiberCall = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    element: LiveElement,
  ) => {
    element = reactInterop(element, fiber) as any;

    const isArray = !!element && Array.isArray(element);

    if (isArray) reconcileFiberCalls(fiber, element as any);
    else {
      const call = element as DeferredCall<any>;
      if (call && (call.f as any)?.isLiveInline) updateFiber(fiber, call as any);
      else mountFiberCall(fiber, call as any);
    }
  }

  // Provide a value for a context on a fiber
  export const provideFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    if (!fiber.args) return;

    const {context: {roots, values}, args: [context, value, calls]} = fiber;

    if (roots.get(context) !== fiber.id) {
      if (fiber.next) throw new Error(`Mounting context on existing continuation`);
      if (!context.context) throw new Error(`'${context.displayName}' is not a context`);

      fiber.context = makeContextState(fiber, fiber.context, fiber.id, context, value);
      pingFiber(fiber);

      // Remember calls
      const ref = fiber.context.values.get(context);
      ref.memo = calls;
    }
    else {
      // Set new value if changed
      const ref = values.get(context);
      const lastValue = ref.current;
      if (value !== lastValue) {
        bustFiberDeps(fiber);
        pingFiber(fiber);

        ref.current = value;
      }
      // If memoized and mounts are identical, stop
      else {
        pingFiber(fiber, false);

        const lastCalls = ref.memo;
        if (lastCalls === calls) return;
        ref.memo = calls;
      }
    }

    inlineFiberCall(fiber, calls);
  }

  // Capture values from a co-context on a fiber
  export const captureFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    if (!fiber.args) return;
    const {context: {roots}, args: [capture, calls, then]} = fiber;

    bustFiberDeps(fiber);
    pingFiber(fiber);

    if (!fiber.next || roots.get(capture) !== fiber.next) {
      if (fiber.next) throw new Error(`Mounting capture on existing continuation`);
      if (!capture.capture) throw new Error(`'${capture.displayName}' is not a capture`);

      const registry = new Map<LiveFiber<any>, any>();
      const reduction = () => {
        const keys = Array.from(registry.keys());
        keys.sort((a, b) => compareFibers(a, b));
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return keys.map(k => registry.get(k)!);
      };

      const Resume = makeFiberReduction(fiber, reduction);
      fiber.next = makeNextFiber(fiber, Resume, 1, 'Resume');

      fiber.context = makeContextState(fiber, fiber.context, fiber.next, capture, registry);
      fiber.path = [...fiber.path, 0];
      fiber.fork = true;
    }

    inlineFiberCall(fiber, calls);
    mountFiberContinuation(fiber, use(fiber.next.f, then));
  }

  // Mount a reconciler on a fiber
  export const reconcileFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    if (!fiber.args) return;
    // eslint-disable-next-line prefer-const
    let {id, quotes, args: [reconciler, calls]} = fiber;

    pingFiber(fiber);

    if (quotes.get(reconciler)?.root !== id) {
      if (fiber.next) throw new Error(`Mounting reconciler on existing continuation`);
      if (!reconciler.reconciler) throw new Error(`'${reconciler.displayName}' is not a reconciler`);

      // Dummy fiber to act as new tree root, never called directly
      const next = fiber.next = makeNextFiber(fiber, () => { throw new Error(); }, 1, 'Root', false, reconciler.displayName);
      next.quotes = quotes;

      quotes = fiber.quotes = new Map(quotes);
      quotes.set(reconciler, makeQuoteState(id, fiber, next));

      fiber.fork = true;
      next.f.isLiveReconcile = true;
    }

    inlineFiberCall(fiber, calls);
  }

  // Detach a fiber by mounting a subcontext manually and delegating the triggering of its execution
  export const detachFiber = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    if (!fiber.args) return;
    // eslint-disable-next-line prefer-const
    let {host, next, args: [call, callback]} = fiber;

    bustFiberDeps(fiber);
    pingFiber(fiber);

    if (Array.isArray(call)) call = {f: FRAGMENT, args: call} as any;

    if (!next || (next.f !== call.f)) {
      if (next) disposeFiber(next);
      next = fiber.next = makeSubFiber(fiber, call);
    }
    next.args = call.args;

    let immediate = true;
    callback(() => {
      if (next && host) {
        const LOG = LOGGING.render || LOGGING.detach;
        LOG && console.log("Run detached", formatNode(next), 'by', formatNode(fiber));

        if (immediate) {
          host.visit(next);
        }
        else {
          host.schedule(next);
          host.flush();
        }
      }
    }, fiber.next);
    immediate = false;
  }

  // Dispose of a fiber's resources and all its mounted sub-fibers
  export const disposeFiber = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    disposeFiberState(fiber);

    fiber.bound = undefined;
    if (fiber.host) fiber.host.dispose(fiber);
    pingFiber(fiber);
  }

  // Dispose of a fiber's state and mounts
  export const disposeFiberState = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    const {id, next, quote, unquote, yeeted} = fiber;

    if (fiber.type === SIGNAL) {
      fiber.quote = null;
    }
    if (fiber.type === QUOTE) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const {to} = quote!;
      if (to.bound) {
        reconcileFiberCall(to, null, id, true);
        pingFiber(to, false);
      }

      fiber.quote = null;
    }
    if (fiber.type === UNQUOTE) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const {to} = unquote!;
      if (to.bound) {
        reconcileFiberCall(to, null, id, true);
        pingFiber(to, false);
      }
    }

    disposeFiberMounts(fiber);
    if (next) disposeFiber(next);
    fiber.next = null;
    fiber.fork = false;

    if (yeeted) {
      bustFiberYeet(fiber, true);
      visitYeetRoot(fiber);
      if (yeeted.scope) fiber.yeeted = yeeted.scope;
    }
  }

  // Dispose of a fiber's mounted sub-fibers
  export const disposeFiberMounts = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    const {mount, mounts} = fiber;

    if (mount) disposeFiber(mount);
    if (mounts) for (const key of mounts.keys()) {
      const mount = mounts.get(key);
      if (mount) disposeFiber(mount);
    }

    fiber.mount = fiber.mounts = null;
  }

  // Update a fiber in-place and recurse
  export const updateMount = <P extends ArrowFunction>(
    parent: LiveFiber<P>,
    mount?: LiveFiber<any> | null,
    newMount?: DeferredCall<any> | null,
    key?: Key,
    keyed?: boolean,
  ): LiveFiber<any> | null | false => {
    const LOG = LOGGING.mount;
    const {host} = parent;

    let from = mount?.f;
    let to = newMount?.f;

    if (!to && newMount) {
      const node = formatNode(newMount);
      throw new Error("Undefined JSX element type: " + node);
    }

    if ((from === to) && (from === PROVIDE || from === CAPTURE)) {
      from = mount?.args?.[0] as any;
      to = newMount?.args?.[0] as any;
    }

    const update  = from && to;
    const replace = update && from !== to;

    if ((!to && from) || replace) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      LOG && console.log('Unmounting', key, formatNode(mount!));
      if (host) host.__stats.unmounts++;
      if (!replace) return null;
    }

    if ((to && !from) || replace) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      LOG && console.log('Mounting', key, formatNode(newMount!));
      if (host) host.__stats.mounts++;
      // Destroy yeet caches because trail of contexts downwards starts empty
      bustFiberYeet(parent, true);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const mount = makeSubFiber(parent, newMount!, newMount!.by ?? parent.id, key, keyed);
      return mount;
    }

    if (update) {
      const aas = newMount?.args;
      const aa = newMount?.arg;
      const args = aas !== undefined ? aas : (aa !== undefined ? [aa] : undefined);

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (mount!.args === args && !to?.isImperativeFunction && !(to === YEET && !args)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        LOG && console.log('Skipping', key, formatNode(newMount!));
        return false;
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      LOG && console.log('Updating', key, formatNode(newMount!));

      if (host) host.__stats.updates++;

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      mount!.args = args;

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return mount!;
    }

    return false;
  }

  // Flush dependent updates after adding / updating / removing a mount
  export const flushMount = <F extends ArrowFunction>(
    mount?: LiveFiber<F> | null,
    mounted?: LiveFiber<any> | null,
    fenced?: boolean,
  ) => {
    if (mounted && mounted !== mount) {
      disposeFiber(mounted);
    }
    if (mount) {
      const {host} = mount;

      // Slice into new stack if too deep, or if fenced
      if (host && (fenced || host?.slice(mount.depth))) {
        const LOG = LOGGING.render;
        LOG && console.log("Slice dispatch to", formatNode(mount));

        return host.visit(mount);
      }

      const element = renderFiber(mount);
      updateFiber(mount, element);
    }
  }

  // Ensure a re-render of the associated yeet root
  export const visitYeetRoot = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
    force?: boolean,
  ) => {
    const {host, type, yeeted} = fiber;
    if (yeeted && (type === YEET || force)) {
      const LOG = LOGGING.render;
      const {root} = yeeted;

      LOG && console.log('Visit yeet root', formatNode(root), 'by', formatNode(fiber));
      bustFiberMemo(root);
      if (host) host.visit(root);
    }
  }

  // Remove a cached yeeted value and all upstream reductions
  export const bustFiberYeet = <F extends ArrowFunction>(fiber: LiveFiber<F>, force?: boolean) => {
    const {type, yeeted} = fiber;
    if (yeeted && (type === YEET || force)) {
      let yt = yeeted;
      yt.value = undefined;

      if (force) yt.reduced = undefined;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      while ((yt = yt.parent!) && (yt.reduced !== undefined)) {
        yt.reduced = undefined;
      }
    }
  }

  // Force a memoized fiber to update next render
  export const bustFiberMemo = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    if (fiber.version != null) fiber.version = incrementVersion(fiber.version);
  }

  // Ping a fiber when it's updated,
  // propagating to long-range dependencies.
  export const bustFiberDeps = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    // Bust far caches
    const {host} = fiber;
    if (host) for (const sub of host.traceDown(fiber)) {
      const LOG = LOGGING.render;
      LOG && console.log(`Invalidating node #${sub.id}`, formatNode(sub), 'by', formatNode(fiber));

      host.visit(sub);
      bustFiberMemo(sub);
    }
  }

  // Bust the order of quoted/unquoted yeets,
  // in case of key re-ordering.
  export const bustFiberQuote = <F extends ArrowFunction>(
    fiber: LiveFiber<F>,
  ) => {
    const {host, quotes, unquote} = fiber;
    for (const k of quotes.keys()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const {to, to: {next, order}} = quotes.get(k)!;
      if (next && order?.length) {
        const LOG = LOGGING.quote;
        LOG && console.log(`Invalidating quote #${to.id}`, formatNode(to), 'by', formatNode(fiber));

        order.length = 0;
        if (host) host.visit(next);
      }
    }
    if (unquote) {
      const {to, to: {next, order}} = unquote;
      if (next && order?.length) {
        const LOG = LOGGING.quote;
        LOG && console.log(`Invalidating unquote ${to.id}`, formatNode(to), 'by', formatNode(fiber));

        order.length = 0;
        if (host) host.visit(next);
      }
    }
  }

  // Track number of runs per fiber
  export const pingFiberCount = <F extends ArrowFunction>(fiber: LiveFiber<F>) => {
    fiber.runs = incrementVersion(fiber.runs);
  }

  // Get argument count for a function, including optional arguments.
  export const getArgCount = <F extends Function>(f: F) => {
    if ((f as any)?.argCount != null) return (f as any).argCount;

    let s = Function.toString.call(f).split(/\)|=>/)[0];
    if (s == null) return 0;

    s = s.replace(/\s+/g, '').replace(/^\(/, '').replace(/,$/, '');
    if (s.length === 0) return 0;

    return s.split(',').length;
  }

/* hooks.ts */
  const NO_RESOURCE = {tag: null, value: null};
  const STATE_SLOTS = 3;

  const HOOK_NAMES = ['useState', 'useMemo', 'useOne', 'useCallback', 'useResource', 'useContext', 'useCapture', 'useVersion', 'useHooks'];

  export const reserveState = (slots: number) => slots * STATE_SLOTS;

  export const pushState = <F extends Function>(fiber: LiveFiber<F>, hookType: Hook) => {
    // eslint-disable-next-line prefer-const
    let {state, pointer} = fiber;
    if (!state) state = fiber.state = [];
    fiber.pointer += STATE_SLOTS;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const marker = state![pointer];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (marker === undefined) state![pointer] = hookType;
    else if (marker !== hookType) throw new Error(`Hooks were not called in the same order as last render in ${formatNode(fiber)}.\nExpected '${HOOK_NAMES[marker]}', got '${HOOK_NAMES[hookType] ?? 'unknown'}'`);

    return pointer + 1;
  }

  export const discardState = <F extends Function>(fiber: LiveFiber<F>) => {
    const {state, pointer} = fiber;
    if (!state) return;

    const n = state.length;
    if (n) while (fiber.pointer < n) {
      const i = fiber.pointer;
      const type = state[i];
      switch (type) {
        default:
          useNoHook(type)();
          break;
        case Hook.HOOKS:
          if (state[i + 1]) useNoHooks();
          else fiber.pointer += 3;
          break;
        case Hook.RESOURCE:
          useNoResource();
          break;
        case Hook.CONTEXT:
          if (state[i + 1]) useNoContext(state[i + 2]);
          else fiber.pointer += 3;
          break;
        case Hook.CAPTURE:
          if (state[i + 1]) useNoCapture(state[i + 2]);
          else fiber.pointer += 3;
          break;
      }
    }
    state.length = pointer;
  }

  /**
   * Return current fiber.
   */
  export const useFiber = () => {
    const fiber = getCurrentFiber();
    if (!fiber) throw new Error(`Live Hook called outside of rendering cycle in ${formatNode(fiber)}.\n\nMake sure you are not accidentally running two copies of '@use-gpu/live' side-by-side. Check your 'node_modules/'.`);
    return fiber;
  }

  export const useFiberId = () => useFiber().id;

  export const useNoHook = (hookType: Hook) => () => {
    const fiber = useFiber();

    const i = pushState(fiber, hookType);
    const {state} = fiber;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i] = undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i + 1] = undefined;
  };

  type IsEqualMemoArgs<T extends Array<any>> = (prevArgs: T, nextArgs: T) => boolean;
  type IsEqualMemoProps<T> = (prevProps: T, nextArgs: T) => boolean;

  const makeDeps = (): any[] => [];

  /**
   * Memoize a live function on all its arguments (shallow comparison per arg)
   */
  export const memoArgs = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    isEqualOrName?: IsEqualMemoArgs<Parameters<F>> | string,
    name?: string,
  ) => {
    const customMemo = typeof isEqualOrName === 'function' ? isEqualOrName as IsEqualMemoArgs<any> : null;
    if (typeof isEqualOrName === 'string') name = isEqualOrName;

    const memoized = (...args: any[]) => {
      const fiber = useFiber();
      if (!fiber.version) fiber.version = 1;

      const ref = useRef(args);

      if (fiber.version === fiber.memo) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (customMemo && !customMemo(ref.current, args)) fiber.version = incrementVersion(fiber.version!);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        else if (ref.current !== args && !isSameDependencies(ref.current, args)) fiber.version = incrementVersion(fiber.version!);
      }

      ref.current = args;

      return useHooks(() => f(...args), fiber.version);
    };

    const memoName = `Memo(${name ?? f.name ?? 'Component'})`;
    const length = getArgCount(f);

    return new Proxy(memoized, { get: (target: any, s: string) => {
      if (s === 'length') return length;
      if (s === 'name') return memoName;
      if (s === 'argCount') return length;
      return target[s];
    }}) as LiveFunction<F>;
  };

  /**
   * Memoize a live function with 1 argument on its object props (shallow comparison per arg)
   */
  export const memoProps = <F extends ArrowFunction>(
    f: LiveFunction<F>,
    isEqualOrName?: IsEqualMemoProps<Parameters<F>[0]> | string,
    name?: string,
  ) => {
    const customMemo = typeof isEqualOrName === 'function' ? isEqualOrName as IsEqualMemoArgs<any> : null;
    if (typeof isEqualOrName === 'string') name = isEqualOrName;

    const memoized = (customMemo
      ? (props: Record<string, any>) => {
        const fiber = useFiber();
        if (!fiber.version) fiber.version = 1;

        const ref = useRef(props);

        if (fiber.version === fiber.memo) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          if (!customMemo(ref.current, props)) fiber.version = incrementVersion(fiber.version!);
        }
        ref.current = props;

        return useHooks(() => f(props), fiber.version);
      }
      : (props: Record<string, any>) => {
        const fiber = useFiber();
        if (!fiber.version) fiber.version = 1;

        const [swapDeps, getDeps] = useDouble(makeDeps);
        const [deps, saved] = getDeps();

        deps.length = 0;
        for (const k in props) {
          deps.push(k);
          deps.push(props[k]);
        }

        if (fiber.version === fiber.memo) {
          if (!isSameDependencies(deps, saved)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fiber.version = incrementVersion(fiber.version!);
          }
        }
        swapDeps();

        return useHooks(() => f(props), fiber.version);
      }
    );

    const memoName = `Memo(${name ?? f.name ?? 'Component'})`;
    const length = getArgCount(f);

    return new Proxy(memoized, { get: (target: any, s: string) => {
      if (s === 'length') return length;
      if (s === 'name') return memoName;
      return target[s];
    }}) as LiveFunction<F>;
  }

  /**
   * Memoize a live component on its props (shallow comparison per arg)
   */
  export const memo = memoProps;

  /**
   * Allocate a state value and a setter for it, initializing with the given value or function.
   */
  export const useState = <T>(
    initialState: Initial<T>,
  ): [
    T,
    Setter<T>,
  ] => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.STATE);
    const {state, host} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let value    = state![i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let setValue = state![i + 1];

    if (setValue === undefined) {
      value = (initialState instanceof Function) ? initialState() : initialState;  // <- Step through here
      setValue = host
        ? (value: Reducer<T>) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (state![i - 1] !== Hook.STATE) return;

            const apply = () => {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const prev = state![i];

              let next: any;
              if (value instanceof Function) next = value(prev);
              else next = value;

              if (prev !== next) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                state![i] = next;
                bustFiberMemo(fiber);
                return true;
              }
              return false;
            };

            if (fiber === getCurrentFiber()) {
              if (apply()) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                host!.visit(fiber);
              }
            }
            else {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              host!.schedule(fiber, apply);
            }
          }
        : NOP;

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = value;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = setValue;
    }

    return [value as unknown as T, setValue];
  }

  /**
   * Memoize a value with given dependencies
   */
  export const useMemo = <T>(
    initialState: () => T,
    dependencies: any[] = NO_DEPS
  ): T => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.MEMO);
    const {state} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let value = state![i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const deps = state![i + 1];

    if (!isSameDependencies(deps, dependencies)) {
      value = initialState(); // <- Step through here

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = value;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = dependencies;
    }

    return value as unknown as T;
  }

  /**
   * Memoize a value with one dependency
   */
  export const useOne = <T>(
    initialState: () => T,
    dependency: any = null,
  ): T => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.ONE);
    const {state} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let value = state![i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const dep = state![i + 1];

    if (dep !== dependency) {
      value = initialState();  // <- Step through here

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = value;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = dependency;
    }

    return value as unknown as T;
  }

  /**
   * Memoize a function with given dependencies
   */
  export const useCallback = <T extends Function>(
    initialValue: T,
    dependencies: any[] = NO_DEPS
  ): T => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.CALLBACK);
    const {state} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let value = state![i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const deps = state![i + 1];

    if (!isSameDependencies(deps, dependencies)) {
      value = initialValue;

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = value;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = dependencies;
    }

    return value as unknown as T;
  }

  /**
   * Incrementing version counter, +1 for every change.
   */
  export const useVersion = <T>(nextValue: T) => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.VERSION);
    const {state} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = state![i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let version = state![i + 1] || 0;
    if (value !== nextValue) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = nextValue;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = version = incrementVersion(state![i + 1]);
    }

    return version;
  }

  /**
   * Bind immediately to a resource, with auto-cleanup on dep change or unmount
   */
  export const useResource = <R>(
    callback: (dispose: (f: Function) => void) => R,
    dependencies: any[] = NO_DEPS
  ): R => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.RESOURCE);
    const {state, host} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let {tag} = state![i] ?? NO_RESOURCE;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const deps = state![i + 1];

    if (!isSameDependencies(deps, dependencies)) {

      if (!tag) {
        tag = makeResourceTag();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i] = {tag, value: null};

        if (host) host.track(fiber, tag);
      }
      else {
        tag(null);
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = dependencies;

      const value = callback(tag); // <- Step through here
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i].value = value;
      return value;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return state![i].value as R;
  }

  /**
   * Don't use a resource hook (clean up prior tag)
   */
  export const useNoResource = () => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.RESOURCE);
    const {state, host} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const {tag} = state![i] ?? NO_RESOURCE;
    if (tag) {
      tag(null);
      if (host) host.untrack(fiber, tag);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i] = undefined;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i + 1] = undefined;
  }

  /**
   * Grab a context from the fiber
   */
  export const useContext = <C>(
    context: LiveContext<C>,
  ): C => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.CONTEXT);
    const {state, host, context: {values, roots}} = fiber;
    const root = roots.get(context) as number;
    if (!context) throw new Error(`Context is undefined in ${formatNode(fiber)}.`);
    if (!root) {
      const {initialValue, displayName} = context;
      if (initialValue === undefined) {
        throw new Error(`Required context '${displayName}' was used without being provided in ${formatNode(fiber)}.`);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = false;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i + 1] = context;
      return initialValue;
    }

    if (host) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (!state![i]) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i] = true;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i + 1] = context;
        host.track(fiber, () => host.undepend(fiber, root));
      }

      host.depend(fiber, root);
    }

    const value = values.get(context).current;
    return value !== undefined ? value : context.initialValue as C;
  }

  /**
   * Yield a value to a capture from the fiber
   */
  export const useCapture = <C>(
    context: LiveCapture<C>,
    value: C,
  ) => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.CAPTURE);
    const {state, host, context: {values, roots}} = fiber;
    const root = roots.get(context) as LiveFiber<any>;
    if (!context) throw new Error(`Context is undefined in ${formatNode(fiber)}.`);
    if (!root) throw new Error(`Capture '${context.displayName}' was used without being provided in ${formatNode(fiber)}.`);

    if (host) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (!state![i]) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i] = true;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i + 1] = context;
        host.track(fiber, () => {
          registry.delete(fiber);
          host.schedule(root);
          host.undepend(root, fiber.id);
        });

        host.depend(root, fiber.id);
      }

      host.visit(root);
    }

    const registry = values.get(context).current;
    registry.set(fiber, value);
  }

  /**
   * Don't use a context from the fiber
   */
  export const useNoContext = <C>(
    context: LiveContext<C>,
  ) => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.CONTEXT);
    const {state, host, context: {roots}} = fiber;
    if (!context) throw new Error(`Context is undefined in ${formatNode(fiber)}.`);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const root = roots.get(context)! as number;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (state![i]) {
      if (host) host.undepend(fiber, root);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = false;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i + 1] = undefined;
  }

  /**
   * Don't use a capture from the fiber
   */
  export const useNoCapture = <C>(
    context: LiveCapture<C>,
  ) => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.CAPTURE);
    const {state, host, context: {values, roots}} = fiber;
    if (!context) throw new Error(`Capture is undefined in ${formatNode(fiber)}.`);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const root = roots.get(context)! as LiveFiber<any>;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (state![i] && root) {
      const registry = values.get(context).current;
      registry.delete(fiber);

      if (host) host.undepend(root, fiber.id);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      state![i] = false;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i + 1] = undefined;
  }

  /**
   * Memoize a hook with given dependencies
   */
  export const useHooks = <T>(
    initialState: () => T,
    dependencies: any[] | number = 0
  ): T => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.HOOKS);
    const {state} = fiber;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const scope = state![i];

    const {pointer} = fiber;
    const hook = typeof dependencies === 'number' ? useOne : useMemo;

    const value = hook(() => {
      try {
        fiber.pointer = 0;
        fiber.state = scope;
        return initialState();  // <- Step through here
      }
      finally {
        discardState(fiber);

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i] = fiber.state;
        fiber.pointer = pointer + STATE_SLOTS;
        fiber.state = state;
      }
    }, dependencies as any);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    state![i + 1] = undefined;

    return value as unknown as T;
  }

  export const useNoHooks = () => {
    const fiber = useFiber();

    const i = pushState(fiber, Hook.HOOKS);
    const {pointer, state} = fiber;
    const scope = state?.[i];

    if (scope) {
      const {pointer} = fiber;
      try {
        fiber.pointer = 0;
        fiber.state = scope;
        discardState(fiber);
      }
      finally {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state![i] = undefined;
        fiber.pointer = pointer + STATE_SLOTS;
        fiber.state = state;
      }
    }
    else {
      fiber.pointer = pointer + STATE_SLOTS;
    }
  };

  // Togglable hooks
  export const useNoState = useNoHook(Hook.STATE);
  export const useNoMemo = useNoHook(Hook.MEMO);
  export const useNoOne = useNoHook(Hook.ONE);
  export const useNoCallback = useNoHook(Hook.CALLBACK);
  export const useNoVersion = useNoHook(Hook.VERSION);

  /**
   * On-change logger for debug purposes.
   */
  export const useLog = (values: Record<string, any>) => {
    for (const k in values) useOne(() => console.log(k, '=', values[k]), values[k]);
  };

  /**
   * Double-buffered mutable reference.
   */
  export const useDouble = <T>(
    make: () => T,
    dependencies: any[] = NO_DEPS
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ): DoubleState<T> => useMemo(() => makeDouble(make), dependencies);

  const makeDouble = <T>(make: () => T): DoubleState<T> => {
    const ref = {
      front: make(),
      back: make(),
      flip: false,
    };

    const front: [T, T] = [ref.front, ref.back];
    const back: [T, T] = [ref.back, ref.front];

    const get = () => {
      const f = ref.flip;
      return f ? front : back;
    };

    const swap = () => {
      let f = ref.flip;
      f = ref.flip = !ref.flip;
      return f ? ref.front : ref.back;
    };

    return [swap, get];
  };

  export const useNoDouble = useNoMemo;

  export const useInterval = (
    f: ArrowFunction,
    duration: number,
    deps: readonly any[] = []
  ) => {
    useResource((dispose) => {
      const id = setInterval(f, duration)
      dispose(() => clearInterval(id))
    }, deps as any[])
  }
  /**
   * Async wrapper
   */
  export const useAwait = <T, E = Error>(
    f: undefined | null | ((cancelled: () => boolean) => Promise<T>),
    dependencies: any[],
  ): [T | undefined, E | undefined, boolean] => {
    const [value, setValue] = useState<[T | undefined, E | undefined]>([(f ? undefined : null) as any, undefined]);
    const loadingRef = useRef(false);

    useResource((dispose) => {
      if (!f) return;

      loadingRef.current = true;
      let cancelled = false;
      f(() => cancelled)
      .then(value => { loadingRef.current = false; if (!cancelled) setValue([value, undefined]); })
      .catch(error => { loadingRef.current = false; if (!cancelled) setValue([undefined, error]); });
      dispose(() => { cancelled = true; });
    }, dependencies);

    return [...value, loadingRef.current];
  };

  export const useNoAwait = () => {
    useNoState();
    useNoRef();
    useNoResource();
  };

  /**
   * Ref emulator
   */
  interface UseRef {
    <T>(current?: T): Ref<T>;
    <T>(current?: T | null): RefObject<T>;
    <T = undefined>(): MutableRefObject<T | undefined>;
  }
  export const useRef: UseRef = (<T>(current?: T | null) => useOne(() => ({current}))) as any;
  export const useNoRef = useNoOne;

  // Cleanup effect tracker
  // Calls previous cleanup before accepting new one
  /** @hidden */
  export const makeResourceTag = () => {
    let cleanup = undefined as Task | undefined;

    return (f?: Task) => {
      if (cleanup) cleanup();
      cleanup = f;
    }
  }

/* queue.ts */

    type Q = {
      fiber: LiveFiber<any>
      next: Q | null,
    };
    // Priority queue that maintains fibers in tree order.
    // Allows for quick append at head or tail, or right after last insertion.
    //
    // The queue is typically short and almost always first-in-first-out.
    export const makeFiberQueue = (init?: LiveFiber<any>[]): FiberQueue => {
      
      let queue: Q | null = null;
      let tail: Q | null = null;
      let hint: Q | null = null;

      const set = new Set<LiveFiber<any>>();

      // Insert fiber into queue
      const insert = (fiber: LiveFiber<any>) => {
        if (set.has(fiber)) return;
        set.add(fiber);

        // Empty
        if (!queue) {
          tail = queue = {fiber, next: null};
          return;
        }

        // Append
        if (tail) {
          if (compareFibers(tail.fiber, fiber) <= 0) {
            tail = tail.next = {fiber, next: null};
            return;
          }
        }

        // Prepend
        if (compareFibers(queue.fiber, fiber) >= 0) {
          queue = {fiber, next: queue};
          return;
        }

        if (!queue.next) return;

        // Skip ahead
        let q = queue;
        if (hint && compareFibers(hint.fiber, fiber) <= 0) {
          q = hint;
        }

        // Iterate
        while (q.next) {
          if (compareFibers(q.next.fiber, fiber) >= 0) {
            q.next = {fiber, next: q.next};
            hint = q;
            return;
          }
          q = q.next;
        }
      }

      // Remove fiber from queue
      const remove = (fiber: LiveFiber<any>) => {
        if (!queue) return;
        if (!set.has(fiber)) return;
        set.delete(fiber);

        // Pop
        if (queue.fiber === fiber) {
          if (hint === queue) hint = hint.next;

          queue = queue.next;
          if (!queue) tail = null;

          return;
        }

        let q = queue;
        while (q.next) {
          const qn = q.next;
          if (qn.fiber === fiber) {
            if (hint === qn) hint = hint.next;
            q.next = qn.next;
            if (!q.next) tail = q;
            return;
          }
          q = q.next;
        }
      }

      // Re-insert all fibers that descend from fiber
      const reorder = (fiber: LiveFiber<any>) => {
        const list: LiveFiber<any>[] = [];

        let q = queue;
        let qp = null;

        while (q) {
          if (compareFibers(fiber, q.fiber) >= 0) {
            hint = qp = q;
            q = q.next;
            continue;
          }
          if (isSubNode(fiber, q.fiber)) {
            list.push(q.fiber);
            if (qp) {
              qp.next = q.next;
              q = q.next;
            }
            else {
              pop();
              q = q.next;
            }
          }
          break;
        }

        if (list.length) {
          list.sort(compareFibers);
          list.forEach(insert);
        }
      };

    // Return entire queue (debug)
    const all = () => {
      const out = [];
      let q = queue;
      while (q) {
        out.push(q.fiber);
        q = q.next;
      }
      return out;
    }

    // Return top of queue
    const peek = (): LiveFiber<any> | null => {
      if (!queue) return null;
      return queue.fiber;
    }

    // Pop top of queue
    const pop = (): LiveFiber<any> | null => {
      if (!queue) return null;

      const q = queue;
      queue = q.next;

      if (hint === q) hint = hint.next;
      if (!queue) tail = null;

      set.delete(q.fiber);

      return q.fiber;
    }

    if (init) for (const i of init) insert(i);

    return {insert, remove, reorder, all, peek, pop} as any;
}

/* hmr.ts - probably not needed */
  const MARKER = 'Live/HMR-v1';

  /** Hot-reload an App root with a webpack/vite-compatible module interface.

  Will discard all prior state and do a full re-render.
  ```
  const App = () => { ... };
  export default hot(App, module);
  ```
  */
  export const hot = (fn: LiveFunction<any>, mod: any) => {

    const fibers: Set<LiveFiber<any>> = new Set();

    // Resolve HMR API from either a webpack-like `module` (`module` or `module.hot`)
    // or an HMR object passed in by Vite (e.g. `import.meta` or `import.meta.hot`).
    // We avoid referencing `import.meta` here so that TypeScript won't error
    // for webpack-style builds on older module systems.
    const hot = mod ? (((mod as any).hot ?? (mod as any)) as any) : undefined;
    if (!hot) return fn;

    const wrapped = new Proxy((...args: any[]) => {
      const fiber = useFiber();
      useResource((dispose) => {
        fibers.add(fiber);
        dispose(() => fibers.delete(fiber));
      });
      return fn(...args);
    }, {
      get: (target, prop) => {
        if (prop === 'name') return fn.displayName ?? fn.name;
        return (target as any)[prop];
      },
    });

    const data = (hot as any).data;
    if (data && data.marker !== MARKER) {
      // Vite's HMR runtime's methods (`accept`, `dispose`, `invalidate`, etc.) require `this` to be the hot object
      (hot as any).invalidate?.();
    }
    else {
      (hot as any).dispose?.((data: any) => {
        data.marker = MARKER;
        data.fibers = Array.from(fibers);
      });
      (hot as any).accept?.();

      if (data && data.fibers) {
        for (const f of data.fibers) {
          fibers.add(f);

          enterFiber(f, 0);
          exitFiber(f);
          disposeFiber(f);

          f.f = wrapped;
          f.bound = bind(wrapped, f);
          f.type = null;

          renderFibers(f.host, [f]);
        }
      }
    }

    return wrapped;
  };

/* debug.ts */
  const {prototype: {hasOwnProperty}} = Object;
  const ARRAY_OR_BUFFER = /Array$|^ArrayBuffer$/;
  export type LoggingOptions = {
    tick: boolean,
    dispatch: boolean,
    mount: boolean,
    render: boolean,
    quote: boolean,
    detach: boolean,
  };
  /** @hidden */
  export const LOGGING = {
      tick: false,
      dispatch: false,
      mount: false,
      render: false,
      quote: false,
      detach: false,
  } as Record<string, boolean>;
  /** Turn on logging for the Live run-time. Very chatty.
  - `tick`: Log a divider between tree renders
  - `dispatch`: All dispatches to roots and sub-roots.
  - `fiber`: All updates to individual fibers.
  */
  export const setLogging = (options: LoggingOptions) => {
    for (const k in options) LOGGING[k] = (options as any)[k];
  };

  export const formatSnapshot = (arg: any, depth: number = 0): string => {
    const args = Array.isArray(arg) ? arg : (arg !== undefined ? [arg] : []);
    return args.map(a => formatSnapshotArg(a, depth)).join(' ');
  }

  export const formatSnapshotArg = (arg: any, depth: number = 0): string => {
    if (depth > 1) return '…';

    if (Array.isArray(arg)) return '[' + arg.map(formatSnapshotArg) + ']';
    if (typeof arg === 'object' && arg) {
      if (arg.f && arg.args && arg.by) {
        return '<' + formatNodeName(arg) +' ' + formatSnapshot(arg.args ?? arg.arg, depth + 1) + '>';
      }
      return Object.keys(arg).map(k => `${k}={${formatSnapshotArg(arg[k], depth + 1)}}`).join(' ');
    }
    if (typeof arg === 'string') {
      return truncate(arg.replace(/\s+/g, ' '), 255);
    }
    if (typeof arg === 'function') {
      return formatShortValue(arg);
    }
    return `${arg}`;
  }

  export const formatTree = (root: LiveFiber<any>, depth: number = 0): string => {
    const {mount, mounts, order, next} = root;
    const out = [];

    const prefix = '  '.repeat(depth);

    out.push(prefix + '<' + formatNodeName(root) +' '+ formatSnapshot(root.args) + '>');

    if (mount) {
      out.push(formatTree(mount, depth + 1));
    }

    if (mounts && order) {
      for (const key of order) {
        const sub = mounts.get(key);
        if (sub) out.push(formatTree(sub, depth + 1));
      }
    }

    if (next) {
      out.push(formatTree(next, depth));
    }

    return out.join("\n");
  }

  export const formatNodeName = <F extends Function>(_node: LiveElement<F>): string => {
    const node = reactInterop(_node) as DeferredCall<F> | null;
    if (!node) return 'null';

    const {f, args} = node;

    // @ts-ignore
    let name = (f?.displayName ?? f?.name) || 'Fiber';
    if (name === 'PROVIDE' && args) {
      const [context] = args;
      const value = formatValue(context.displayName);
      return `Provide(${value})`;
    }
    else if (name === 'CAPTURE' && args) {
      const [context] = args;
      const value = formatValue(context.displayName);
      return `Capture(${value})`;
    }
    else if (name === 'DETACH' && args) {
      const [call] = args;
      // @ts-ignore
      name = `Detach(${(call.f?.displayName ?? call.f?.name) || 'Fiber'})`;
    }
    else if (name === 'GATHER') {
      name = `Gather`;
    }
    else if (name === 'MULTI_GATHER') {
      name = `MultiGather`;
    }
    else if (name === 'FRAGMENT') {
      name = `Fragment`;
    }
    else if (name === 'MAP_REDUCE') {
      name = `MapReduce`;
    }
    else if (name === 'YEET') {
      name = `Yeet`;
    }
    else if (name === 'RECONCILE') {
      name = `Reconcile`;
    }
    else if (name === 'QUOTE') {
      name = `Quote`;
    }
    else if (name === 'UNQUOTE') {
      name = `Unquote`;
    }
    else if (name === 'SIGNAL') {
      name = `Signal`;
    }
    else if (name === 'MORPH') {
      name = `Morph`;
    }
    else if (name === 'FENCE') {
      name = `Fence`;
    }
    else if (name === 'DEBUG') {
      name = `Debug`;
    }

    return name;
  }

  export const formatNode = <F extends Function>(_node: LiveElement<F>): string => {
    const node = reactInterop(_node) as DeferredCall<F> | null;
    if (!node) return '<null />';

    const name = formatNodeName(node);

    const args = [] as string[];
    if (node.arg !== undefined) {
      args.push(formatValue(node.arg));
    }
    if (node.args !== undefined) {
      if (node.f) {
        if (node.f.name === 'REDUCE') {
          const [, reduce, initial] = node.args;
          args.push(formatValue({reduce, initial}));
        }
        else if (node.f.name === 'PROVIDE') {
          const [context] = node.args;
          args.push(formatValue(context));
        }
        else if (node.f.name === 'MORPH') {
          args.push(formatValue(node.args));
        }
        else {
          if (Array.isArray(node.args)) {
            let list = node.args;
            if (list.length > 100) list = list.slice(0, 100);
            args.push(...list.map(x => formatValue(x)));
          }
        }
      }
      else {
        if (Array.isArray(node.args)) {
          let list = node.args;
          if (list.length > 100) list = list.slice(0, 100);
          args.push(...list.map(x => formatValue(x)));
        }
      }
    }
    if (args?.length) args.unshift('');

    return `<${name}${args ? args.join(' ') : ''}>`;
  }

  export const formatArrayLike = (x: any, seen: WeakMap<object, boolean> = new WeakMap()) => {
    if (!x.buffer && x.byteLength != null) x = new Uint8Array(x.slice(0, 100));

    const out = [];
    const length = x.length ?? 0;
    const n = Math.min(length, 100);
    for (let i = 0; i < n; ++i) {
      out.push(`${formatShortValue(x[i], seen)}`);
    }
    if (length > 100) out.push('…');
    return '[' + out.join(', ') + ']';
  };

  export const formatPrototype = (x: any): string => {
    if (!x) return '' + x;
    if (typeof x === 'object') {
      const signature = Object.keys(x).join('/');
      if (signature === 'f/args/key/by' || signature === 'f/arg/key/by') return `<${formatNodeName(x)} … />`;

      const proto = x.__proto__ !== Object.prototype ? x.__proto__.constructor.name : null;
      const label = x.label;
      const short = signature.length === 0 ? '{}' : null;
      return [proto, label, short].filter(s => s?.length).join(' ');
    }
    return '';
  }

  export const formatValue = (x: any, seen: WeakMap<object, boolean> = new WeakMap()): string => {
    if (!x) return '' + x;
    if (Array.isArray(x) || x?.constructor?.name?.match(ARRAY_OR_BUFFER)) {
      if (seen.get(x)) return '[Repeated]';
      seen.set(x, true);

      return formatArrayLike(x, seen);
    }
    if (typeof x === 'object') {
      if (seen.get(x)) return '[Repeated]';
      seen.set(x, true);

      const signature = Object.keys(x).join('/');
      if (signature === 'f/args/key/by' || signature === 'f/arg/key/by') return formatNode(x);

      const out = [];
      for (const k in x) if (hasOwnProperty.call(x, k)) {
        out.push(`${k}: ${formatShortValue(x[k], seen)}`);
      }

      const proto = x.__proto__ !== Object.prototype ? x.__proto__.constructor.name : '';
      const label = x.label;
      return proto + (label?.length ? ' ' + label : '') + (out.length ? ' {' + out.join(', ') + '}' : ' {}');
    }
    return formatShortValue(x, seen);
  }

  export const formatShortValue = (x: any, seen: WeakMap<object, boolean> = new WeakMap()): string => {
    if (!x) return '' + x;
    if (Array.isArray(x) || x?.constructor?.name?.match(ARRAY_OR_BUFFER)) {
      return formatArrayLike(x, seen);
    }
    if (typeof x === 'boolean') return x ? 'true' : 'false';
    if (typeof x === 'number') return formatNumber(x, 5);
    if (typeof x === 'symbol') return '(symbol)';
    if (typeof x === 'string') return x;
    if (typeof x === 'function') {
      const name = `${x.displayName ?? x.name}(…)`;
      const body = x.toString().split(/=>/)[1];
      return body != null ? (
        name + truncate(
          body
          .replace(/\s+/g, ' ')
          .replace(/\(0,_use_gpu_[a-z_]+__WEBPACK_IMPORTED_MODULE_[0-9]+__.resolve\)/g, '')
        , 40)
      ) : name;
    }
    if (typeof x === 'object') {
      if (x.constructor.name.match(ARRAY_OR_BUFFER)) {
        if (x.length > 100) x = x.slice(0, 100);
      }

      const signature = Object.keys(x).join('/');
      if (signature === 'f/args/key' || signature === 'f/arg/key') return `<${formatNodeName(x)} …/>`;

      return '{…}';
    }
    return '' + x;
  }

  export const formatNumber = (x: number, precision: number = 5) => {
    if (Math.abs(x) < 1) return x.toPrecision(precision).replace(/(?:\.0+)$|(\.[0-9]*[1-9])0+$/, '$1');
    return x.toString();
  };

  const truncate = (s: string, n: number) => {
    if (typeof s !== 'string') return '' + s;
    s = s.replace(/\s+/g, ' ');
    if (s.length < n) return s;
    return s.slice(0, n) + '…';
  };
