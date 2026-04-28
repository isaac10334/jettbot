import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface TimingSummary {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly avgMs: number;
  readonly lastMs: number;
}

export interface MetricsSnapshot {
  readonly timestamp: string;
  readonly counters: Readonly<Record<string, number>>;
  readonly timings: Readonly<Record<string, TimingSummary>>;
}

export interface MetricsService {
  readonly increment: (name: string, value?: number) => void;
  readonly recordTiming: (name: string, durationMs: number) => void;
  readonly snapshot: () => MetricsSnapshot;
  readonly flush: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

interface TimingState {
  count: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

export const createMetricsService = (config: {
  readonly metricsFilePath: string;
  readonly flushIntervalMs: number;
}): MetricsService => {
  const counters = new Map<string, number>();
  const timings = new Map<string, TimingState>();
  let flushing: Promise<void> | undefined;

  const snapshot = (): MetricsSnapshot => {
    const timingEntries = Array.from(timings.entries()).map(([name, value]) => [
      name,
      {
        count: value.count,
        minMs: value.minMs,
        maxMs: value.maxMs,
        avgMs: value.sumMs / value.count,
        lastMs: value.lastMs,
      },
    ]);
    return {
      timestamp: new Date().toISOString(),
      counters: Object.fromEntries(counters),
      timings: Object.fromEntries(timingEntries),
    };
  };

  const flush = async (): Promise<void> => {
    if (flushing) return flushing;
    flushing = (async () => {
      await mkdir(dirname(config.metricsFilePath), { recursive: true });
      await Bun.write(config.metricsFilePath, JSON.stringify(snapshot(), null, 2));
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };

  const timer = setInterval(() => {
    void flush();
  }, config.flushIntervalMs);

  return {
    increment: (name, value = 1) => {
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
    recordTiming: (name, durationMs) => {
      const current = timings.get(name);
      if (!current) {
        timings.set(name, {
          count: 1,
          sumMs: durationMs,
          minMs: durationMs,
          maxMs: durationMs,
          lastMs: durationMs,
        });
        return;
      }
      current.count += 1;
      current.sumMs += durationMs;
      current.minMs = Math.min(current.minMs, durationMs);
      current.maxMs = Math.max(current.maxMs, durationMs);
      current.lastMs = durationMs;
    },
    snapshot,
    flush,
    dispose: async () => {
      clearInterval(timer);
      await flush();
    },
  };
};
