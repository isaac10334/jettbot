import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RealtimeDebugCaptureService {
  readonly startVoiceSession: (input: {
    readonly guildId: string;
    readonly channelId: string;
    readonly sessionId: string;
    readonly startedAt?: Date;
  }) => void;
  readonly endVoiceSession: (input?: { readonly sessionId?: string }) => Promise<void>;
  readonly writeJsonLine: (relativePath: string, value: unknown) => void;
  readonly writeTextLine: (relativePath: string, line: string) => void;
  readonly writeAudioChunk: (key: string, input: RealtimeAudioChunkInput) => void;
  readonly closeAudio: (key: string) => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly currentSessionPath: () => string | undefined;
}

export type RealtimeAudioChunkInput =
  | {
      readonly kind: "pcm_s16le";
      readonly relativePath: string;
      readonly bytes: Uint8Array;
      readonly sampleRate: number;
      readonly channels: number;
    }
  | {
      readonly kind: "binary";
      readonly relativePath: string;
      readonly bytes: Uint8Array;
    };

interface TextSink {
  readonly writeLine: (line: string) => void;
  readonly close: () => Promise<void>;
}

interface AudioSink {
  readonly write: (bytes: Uint8Array) => void;
  readonly close: () => Promise<void>;
  readonly stats: () => AudioSinkStats;
}

interface VoiceDebugSession {
  readonly path: string;
  readonly textSinks: Map<string, TextSink>;
  readonly audioSinks: Map<string, AudioSink>;
}

interface AudioSinkStats {
  readonly relativePath: string;
  readonly kind: RealtimeAudioChunkInput["kind"];
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly chunkCount: number;
  readonly byteCount: number;
  readonly durationMs?: number;
  readonly finalized: boolean;
}

const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

const formatSessionFolderName = (date: Date): string => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${month}-${day}-${year}_${hour12}-${minute}-${ampm}`;
};

const toSerializable = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
    };
  }
  if (value instanceof Uint8Array) {
    return { byteLength: value.byteLength };
  }
  return value;
};

const writeWavHeader = async (file: FileHandle, sampleRate: number, channels: number, dataBytes: number): Promise<void> => {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      header[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  await file.write(header, 0, header.byteLength, 0);
};

const createQueuedTextSink = async (path: string): Promise<TextSink> => {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, "a");
  let queue = Promise.resolve();
  return {
    writeLine: (line) => {
      queue = queue.then(() => file.appendFile(`${line}\n`, "utf8"));
    },
    close: async () => {
      await queue;
      await file.close();
    },
  };
};

const createBinarySink = async (path: string, relativePath: string): Promise<AudioSink> => {
  await mkdir(dirname(path), { recursive: true });
  let queue = Promise.resolve();
  let chunkCount = 0;
  let byteCount = 0;
  let finalized = false;
  return {
    write: (bytes) => {
      const chunk = new Uint8Array(bytes);
      chunkCount += 1;
      byteCount += chunk.byteLength;
      queue = queue.then(async () => {
        const file = await open(path, "a");
        try {
          await file.appendFile(chunk);
        } finally {
          await file.close();
        }
      });
    },
    close: async () => {
      await queue;
      finalized = true;
    },
    stats: () => ({
      relativePath,
      kind: "binary",
      chunkCount,
      byteCount,
      finalized,
    }),
  };
};

const createWavSink = async (path: string, relativePath: string, sampleRate: number, channels: number): Promise<AudioSink> => {
  await mkdir(dirname(path), { recursive: true });
  {
    const file = await open(path, "w+");
    try {
      await writeWavHeader(file, sampleRate, channels, 0);
    } finally {
      await file.close();
    }
  }
  let queue = Promise.resolve();
  let dataBytes = 0;
  let chunkCount = 0;
  let finalized = false;
  return {
    write: (bytes) => {
      const chunk = new Uint8Array(bytes);
      const offset = 44 + dataBytes;
      dataBytes += chunk.byteLength;
      chunkCount += 1;
      queue = queue.then(async () => {
        const file = await open(path, "r+");
        try {
          await file.write(chunk, 0, chunk.byteLength, offset);
          await writeWavHeader(file, sampleRate, channels, dataBytes);
        } finally {
          await file.close();
        }
      });
    },
    close: async () => {
      await queue;
      const file = await open(path, "r+");
      try {
        await writeWavHeader(file, sampleRate, channels, dataBytes);
      } finally {
        await file.close();
      }
      finalized = true;
    },
    stats: () => ({
      relativePath,
      kind: "pcm_s16le",
      sampleRate,
      channels,
      chunkCount,
      byteCount: dataBytes,
      ...(sampleRate > 0 && channels > 0 ? { durationMs: (dataBytes / (sampleRate * channels * 2)) * 1000 } : {}),
      finalized,
    }),
  };
};

export const createRealtimeDebugCaptureService = (config: {
  readonly enabled: boolean;
  readonly baseDir: string;
}): RealtimeDebugCaptureService => {
  const sessions = new Map<string, VoiceDebugSession>();
  let currentSessionId: string | undefined;
  const pendingWrites = new Set<Promise<unknown>>();

  const track = (promise: Promise<unknown>): void => {
    pendingWrites.add(promise);
    void promise.finally(() => {
      pendingWrites.delete(promise);
    });
  };

  const withSession = <T>(fn: (value: VoiceDebugSession) => T): T | undefined => {
    if (!config.enabled || currentSessionId == null) return undefined;
    const session = sessions.get(currentSessionId);
    if (session == null) return undefined;
    return fn(session);
  };

  const closeSession = async (value: VoiceDebugSession): Promise<void> => {
    await Promise.all([...pendingWrites]);
    await Promise.all([...value.audioSinks.entries()].map(async ([key, sink]) => {
      await sink.close();
      const summary = await getTextSink(value, "text/audio-summary.jsonl");
      summary.writeLine(JSON.stringify({
        timestamp: new Date().toISOString(),
        value: {
          type: "audio.closed",
          key,
          ...sink.stats(),
        },
      }));
    }));
    await Promise.all([...value.textSinks.values()].map((sink) => sink.close()));
    value.audioSinks.clear();
    value.textSinks.clear();
  };

  const getTextSink = async (value: VoiceDebugSession, relativePath: string): Promise<TextSink> => {
    const path = sanitizeRelativePath(relativePath);
    const existing = value.textSinks.get(path);
    if (existing) return existing;
    const sink = await createQueuedTextSink(join(value.path, path));
    value.textSinks.set(path, sink);
    return sink;
  };

  const getAudioSink = async (value: VoiceDebugSession, key: string, input: RealtimeAudioChunkInput): Promise<AudioSink> => {
    const existing = value.audioSinks.get(key);
    if (existing) return existing;
    const relativePath = sanitizeRelativePath(input.relativePath);
    const path = join(value.path, relativePath);
    const sink = input.kind === "pcm_s16le" ? await createWavSink(path, relativePath, input.sampleRate, input.channels) : await createBinarySink(path, relativePath);
    value.audioSinks.set(key, sink);
    return sink;
  };

  const writeJsonLine = (relativePath: string, value: unknown): void => {
    void withSession((debugSession) => {
      track(getTextSink(debugSession, relativePath).then((sink) => {
        sink.writeLine(JSON.stringify({ timestamp: new Date().toISOString(), value: toSerializable(value) }));
      }));
    });
  };

  const writeTextLine = (relativePath: string, line: string): void => {
    void withSession((debugSession) => {
      track(getTextSink(debugSession, relativePath).then((sink) => {
        sink.writeLine(line);
      }));
    });
  };

  return {
    startVoiceSession: (input) => {
      if (!config.enabled) return;
      const startedAt = input.startedAt ?? new Date();
      const sessionPath = join(
        config.baseDir,
        `${formatSessionFolderName(startedAt)}_${sanitizePathSegment(input.guildId)}_${sanitizePathSegment(input.channelId)}_${sanitizePathSegment(input.sessionId)}`,
      );
      sessions.set(input.sessionId, { path: sessionPath, textSinks: new Map(), audioSinks: new Map() });
      currentSessionId = input.sessionId;
      writeJsonLine("text/session.jsonl", {
        type: "started",
        guildId: input.guildId,
        channelId: input.channelId,
        sessionId: input.sessionId,
        localTime: startedAt.toLocaleString(),
        path: sessionPath,
      });
    },
    endVoiceSession: async (input) => {
      const sessionId = input?.sessionId ?? currentSessionId;
      const active = sessionId ? sessions.get(sessionId) : undefined;
      if (active == null) return;
      writeJsonLine("text/session.jsonl", { type: "ended" });
      if (sessionId) sessions.delete(sessionId);
      if (currentSessionId === sessionId) currentSessionId = sessions.keys().next().value;
      await closeSession(active);
    },
    writeJsonLine,
    writeTextLine,
    writeAudioChunk: (key, input) => {
      void withSession((debugSession) => {
        track(getAudioSink(debugSession, key, input).then((sink) => {
          sink.write(input.bytes);
          writeJsonLine("text/audio-summary.jsonl", {
            type: "audio.chunk",
            key,
            ...sink.stats(),
          });
        }));
      });
    },
    closeAudio: async (key) => {
      const active = currentSessionId ? sessions.get(currentSessionId) : undefined;
      if (active == null) return;
      const sink = active.audioSinks.get(key);
      if (sink == null) return;
      active.audioSinks.delete(key);
      await sink.close();
      writeJsonLine("text/audio-summary.jsonl", {
        type: "audio.closed",
        key,
        ...sink.stats(),
      });
    },
    dispose: async () => {
      const active = [...sessions.values()];
      sessions.clear();
      currentSessionId = undefined;
      await Promise.all(active.map((value) => closeSession(value)));
    },
    currentSessionPath: () => (currentSessionId ? sessions.get(currentSessionId)?.path : undefined),
  };
};

const sanitizeRelativePath = (value: string): string =>
  value
    .split(/[\\/]+/)
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .map(sanitizePathSegment)
    .join("/");
