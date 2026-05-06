export const defaultElevenLabsPlaybackFormat = "pcm_24000";

export const isSidecarStreamPlaybackFormat = (format: string): boolean => format.startsWith("pcm_");

export const resolveElevenLabsPlaybackFormat = (format: string): string =>
  isSidecarStreamPlaybackFormat(format) ? format : defaultElevenLabsPlaybackFormat;
