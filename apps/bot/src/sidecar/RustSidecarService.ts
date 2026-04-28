import { createSignal, type Signal } from "@loop-kit/common/Signal";
import type { Console } from "@loop-kit/common/Console";
import { encodeJsonLine, readJsonLines } from "../__internal/JsonLineProtocol";
import type { Env } from "../Env";
import type { MetricsService } from "../observability/MetricsService";
import {
  isSidecarResponse,
  type SidecarCommand,
  type SidecarEvent,
  type SidecarMessage,
  validateSidecarMessage,
} from "./RustSidecarProtocol";

export interface RustSidecarService {
  readonly events: Signal<SidecarEvent>;
  readonly start: () => Promise<void>;
  readonly sendCommand: (command: SidecarCommand) => Promise<void>;
  readonly call: (command: SidecarCommand, timeoutMs?: number) => Promise<void>;
  readonly stop: () => Promise<void>;
}

interface PendingCall {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: Timer;
}

const randomId = (): string => crypto.randomUUID();

const resolveSidecarPath = (path: string): string => {
  if (process.platform !== "win32" || path.endsWith(".exe")) return path;
  return `${path}.exe`;
};

const readTextLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
  onError: (error: Error) => void,
  signal: AbortSignal,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (line !== "") onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    const tail = `${buffer}${decoder.decode()}`.trimEnd();
    if (tail !== "") onLine(tail);
  } catch (error) {
    if (!signal.aborted) onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
};

export const createRustSidecarService = (
  env: Env,
  observability?: { readonly console: Console; readonly metrics: MetricsService },
): RustSidecarService => {
  const events = createSignal<SidecarEvent>();
  const pending = new Map<string, PendingCall>();
  let process: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
  let sink: Bun.FileSink | undefined;
  const abortController = new AbortController();
  const console = observability?.console.child("sidecar");
  const metrics = observability?.metrics;

  const write = async (command: SidecarCommand): Promise<void> => {
    if (sink == null) throw new Error("Rust sidecar is not running");
    sink.write(encodeJsonLine(command));
    await sink.flush();
  };

  const handleMessage = (message: SidecarMessage): void => {
    if (isSidecarResponse(message)) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.ok) item.resolve();
      else item.reject(new Error(message.error ?? "Sidecar command failed"));
      return;
    }
    events.emit(message);
  };

  const start = async (): Promise<void> => {
    if (process != null) return;
    process = Bun.spawn({
      cmd: [resolveSidecarPath(env.JETTBOT_RUST_SIDECAR_PATH)],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
        RUST_LOG: env.JETTBOT_LOG_LEVEL,
      },
      onExit: (_subprocess, exitCode, signalCode) => {
        const error = new Error(`Rust sidecar exited: code=${exitCode} signal=${signalCode ?? ""}`);
        for (const [id, call] of pending) {
          clearTimeout(call.timer);
          pending.delete(id);
          call.reject(error);
        }
      },
    });
    const subprocess = process;
    sink = subprocess.stdin;
    void readJsonLines<unknown>(
      subprocess.stdout,
      (value) => handleMessage(validateSidecarMessage(value)),
      (error) => events.emit({ type: "Error", code: "JsonParseError", message: error.message }),
      abortController.signal,
    );
    void readTextLines(
      subprocess.stderr,
      (line) => console?.debug(line),
      (error) => events.emit({ type: "Error", code: "SidecarStderrError", message: error.message }),
      abortController.signal,
    );
  };

  const call = async (command: SidecarCommand, timeoutMs = 15_000): Promise<void> => {
    const id = command.id ?? randomId();
    const start = performance.now();
    metrics?.increment(`sidecar.command.${command.type}.started`);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for sidecar response to ${command.type}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        void write({ ...command, id }).catch((error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
      metrics?.increment(`sidecar.command.${command.type}.completed`);
    } catch (error) {
      metrics?.increment(`sidecar.command.${command.type}.failed`);
      throw error;
    } finally {
      metrics?.recordTiming(`sidecar.command.${command.type}.duration_ms`, performance.now() - start);
    }
  };

  const stop = async (): Promise<void> => {
    if (process == null) return;
    try {
      await call({ type: "Shutdown" }, 2_000);
    } catch {
      process.kill("SIGTERM");
    }
    abortController.abort();
    sink?.end();
    await process.exited.catch(() => 1);
    process = undefined;
    sink = undefined;
  };

  return {
    events,
    start,
    sendCommand: write,
    call,
    stop,
  };
};
