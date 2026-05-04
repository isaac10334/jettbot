export interface YoutubeMedia {
  readonly title?: string;
  readonly mode: "url" | "search";
  readonly query: string;
  readonly url: string;
  readonly webpageUrl?: string;
  readonly durationSeconds?: number;
  readonly playbackFormat: "wav_pcm_s16le_48000_stereo";
}

export interface YoutubePreparedAudioFile {
  readonly path: string;
  readonly format: "wav_pcm_s16le_48000_stereo";
}

export interface YoutubeService {
  readonly resolve: (queryOrUrl: string) => Promise<YoutubeMedia>;
  readonly getAudioStream: (input: YoutubeMedia) => Promise<ReadableStream<Uint8Array>>;
  readonly prepareAudioFile: (input: YoutubeMedia) => Promise<YoutubePreparedAudioFile>;
  readonly stop: () => Promise<void>;
}
