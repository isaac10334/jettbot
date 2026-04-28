export type JsonLineHandler<T> = (message: T) => void;

export class JsonLineParser<T = unknown> {
  private buffer = "";

  constructor(private readonly onMessage: JsonLineHandler<T>, private readonly onError: (error: Error) => void) {}

  push(chunk: Uint8Array | string): void {
    this.buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk, { stream: true });
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line === "") continue;
      try {
        this.onMessage(JSON.parse(line) as T);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

export const encodeJsonLine = (message: unknown): string => `${JSON.stringify(message)}\n`;

export const readJsonLines = async <T>(
  stream: ReadableStream<Uint8Array>,
  onMessage: JsonLineHandler<T>,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const reader = stream.getReader();
  const parser = new JsonLineParser<T>(onMessage, onError);
  try {
    while (!signal?.aborted) {
      const item = await reader.read();
      if (item.done) break;
      parser.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
};

