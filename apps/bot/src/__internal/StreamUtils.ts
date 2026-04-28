export const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const base64ToBytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"));

export async function* streamToChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* chunkTextBySentence(parts: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = "";
  for await (const part of parts) {
    buffer += part;
    const match = buffer.match(/^([\s\S]*?[.!?])(\s+|$)/);
    if (match?.[1] && match[1].trim().length > 0) {
      yield match[1].trim();
      buffer = buffer.slice(match[0].length);
    } else if (buffer.length >= 220) {
      yield buffer.trim();
      buffer = "";
    }
  }
  if (buffer.trim().length > 0) yield buffer.trim();
}

