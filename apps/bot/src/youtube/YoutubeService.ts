export interface YoutubeMedia {
  readonly title?: string;
  readonly url: string;
  readonly webpageUrl?: string;
  readonly durationSeconds?: number;
}

export interface YoutubeService {
  readonly resolve: (queryOrUrl: string) => Promise<YoutubeMedia>;
  readonly getAudioStream: (input: YoutubeMedia) => Promise<ReadableStream<Uint8Array>>;
  readonly stop: () => Promise<void>;
}

