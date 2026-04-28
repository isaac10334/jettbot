import {
  createConsole,
  createConsoleFormatter,
  createMultiOutput,
  createNativeConsoleOutput,
  type Console,
  type ConsoleEntry,
  type ConsoleLevel,
  type ConsoleOutput,
} from "@loop-kit/common/Console";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface LoggingService {
  readonly console: Console;
  readonly flush: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

interface FileConsoleOutput extends ConsoleOutput {
  readonly flush: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const toSerializable = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
    };
  }
  return value;
};

const createNewestFirstFileOutput = (path: string, maxEntries: number, flushIntervalMs: number): FileConsoleOutput => {
  const entries: string[] = [];
  let dirty = false;
  let flushing: Promise<void> | undefined;
  const timer = setInterval(() => {
    void flush();
  }, flushIntervalMs);

  const flush = async (): Promise<void> => {
    if (!dirty) return flushing;
    if (flushing) return flushing;
    flushing = (async () => {
      dirty = false;
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, `${entries.join("\n")}${entries.length > 0 ? "\n" : ""}`);
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };

  return {
    write: (entry: ConsoleEntry) => {
      const record = {
        timestamp: new Date().toISOString(),
        level: entry.method,
        path: entry.path,
        args: entry.args.map(toSerializable),
      };
      entries.unshift(JSON.stringify(record));
      if (entries.length > maxEntries) entries.length = maxEntries;
      dirty = true;
    },
    flush,
    dispose: async () => {
      clearInterval(timer);
      await flush();
    },
  };
};

export const createLoggingService = (config: {
  readonly level: ConsoleLevel;
  readonly logFilePath: string;
  readonly maxEntries: number;
  readonly flushIntervalMs: number;
}): LoggingService => {
  const fileOutput = createNewestFirstFileOutput(config.logFilePath, config.maxEntries, config.flushIntervalMs);
  const console = createConsole({
    level: config.level,
    output: createMultiOutput([createNativeConsoleOutput(), fileOutput]),
    formatter: createConsoleFormatter()({ timestampFormat: "absolute" }),
  });

  return {
    console,
    flush: fileOutput.flush,
    dispose: fileOutput.dispose,
  };
};
