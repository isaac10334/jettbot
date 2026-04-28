export interface TtsService {
  readonly synthesizeStream: (text: string) => Promise<ReadableStream<Uint8Array>>;
}

