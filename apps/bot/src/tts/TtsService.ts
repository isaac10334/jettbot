export interface TtsStreamResult {
  readonly body: ReadableStream<Uint8Array>;
  readonly status?: number;
  readonly contentType?: string;
  readonly requestId?: string;
}

export interface TtsService {
  readonly synthesizeStream: (text: string) => Promise<ReadableStream<Uint8Array>>;
  readonly synthesizeStreamWithMetadata?: (text: string) => Promise<TtsStreamResult>;
}
