export interface PcmFormat {
  readonly sampleRate: number;
  readonly channels: number;
}

export interface NormalizedAudioChunk {
  readonly bytes: Uint8Array;
  readonly sampleRate: 16000;
  readonly channels: 1;
  readonly inputFrameCount: number;
  readonly outputFrameCount: number;
}

export interface PcmS16leNormalizer {
  readonly normalize: (bytes: Uint8Array, format: PcmFormat) => NormalizedAudioChunk;
  readonly reset: () => void;
}

export interface AudioNormalizationService {
  readonly createAssemblyAiNormalizer: () => PcmS16leNormalizer;
}

const readInt16Le = (bytes: Uint8Array, offset: number): number => {
  const value = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
  return value >= 0x8000 ? value - 0x10000 : value;
};

const writeInt16Le = (bytes: Uint8Array, offset: number, value: number): void => {
  const sample = Math.max(-32768, Math.min(32767, Math.round(value)));
  const unsigned = sample < 0 ? sample + 0x10000 : sample;
  bytes[offset] = unsigned & 0xff;
  bytes[offset + 1] = (unsigned >> 8) & 0xff;
};

export const createAudioNormalizationService = (): AudioNormalizationService => ({
  createAssemblyAiNormalizer: () => {
    const pendingMono48k: number[] = [];

    return {
      normalize: (bytes, format) => {
        if (format.sampleRate !== 48000 || format.channels !== 2) {
          throw new Error(`Unsupported Discord PCM format: ${format.sampleRate}Hz ${format.channels}ch`);
        }
        if (bytes.byteLength % 4 !== 0) {
          throw new Error(`Invalid stereo s16le byte length: ${bytes.byteLength}`);
        }

        const inputFrameCount = bytes.byteLength / 4;
        for (let offset = 0; offset < bytes.byteLength; offset += 4) {
          const left = readInt16Le(bytes, offset);
          const right = readInt16Le(bytes, offset + 2);
          pendingMono48k.push((left + right) / 2);
        }

        const outputFrameCount = Math.floor(pendingMono48k.length / 3);
        const output = new Uint8Array(outputFrameCount * 2);
        for (let frame = 0; frame < outputFrameCount; frame += 1) {
          const index = frame * 3;
          const sample = ((pendingMono48k[index] ?? 0) + (pendingMono48k[index + 1] ?? 0) + (pendingMono48k[index + 2] ?? 0)) / 3;
          writeInt16Le(output, frame * 2, sample);
        }
        pendingMono48k.splice(0, outputFrameCount * 3);

        return {
          bytes: output,
          sampleRate: 16000,
          channels: 1,
          inputFrameCount,
          outputFrameCount,
        };
      },
      reset: () => {
        pendingMono48k.length = 0;
      },
    };
  },
});

export const __audioNormalizationTestUtils = {
  readInt16Le,
  writeInt16Le,
};
