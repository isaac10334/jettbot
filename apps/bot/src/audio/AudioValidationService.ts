export interface WavValidationResult {
  readonly format: "wav";
  readonly audioFormat: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly dataBytes: number;
  readonly durationMs: number;
}

export interface RawPcmValidationResult {
  readonly format: "raw";
  readonly sampleRate: number;
  readonly channels: number;
  readonly bytesPerSample: number;
  readonly dataBytes: number;
  readonly durationMs: number;
}

const readAscii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const validatePcmS16leWav = (bytes: Uint8Array): WavValidationResult => {
  if (bytes.byteLength < 44) throw new Error(`WAV is too small: ${bytes.byteLength} bytes`);
  const view = viewOf(bytes);
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("WAV must start with RIFF/WAVE headers");
  }

  let offset = 12;
  let audioFormat: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let dataBytes: number | undefined;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.byteLength) {
      throw new Error(`WAV chunk ${chunkId} length ${chunkSize} exceeds file size ${bytes.byteLength}`);
    }
    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("WAV fmt chunk is too small");
      audioFormat = view.getUint16(chunkStart, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
    if (audioFormat != null && dataBytes != null) break;
  }

  if (audioFormat == null || channels == null || sampleRate == null || bitsPerSample == null) {
    throw new Error("WAV fmt chunk missing");
  }
  if (dataBytes == null) throw new Error("WAV data chunk missing");
  if (audioFormat !== 1) throw new Error(`WAV must be PCM format 1, got ${audioFormat}`);
  if (channels <= 0) throw new Error("WAV channel count must be positive");
  if (sampleRate <= 0) throw new Error("WAV sample rate must be positive");
  if (bitsPerSample !== 16) throw new Error(`WAV must be 16-bit PCM, got ${bitsPerSample}`);
  if (dataBytes === 0) throw new Error("WAV data cannot be empty");
  return {
    format: "wav",
    audioFormat,
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationMs: (dataBytes / (sampleRate * channels * 2)) * 1_000,
  };
};

export const validateRawPcm = (input: {
  readonly bytes: Uint8Array;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bytesPerSample: 2 | 4;
}): RawPcmValidationResult => {
  if (input.sampleRate <= 0) throw new Error("Raw PCM sample rate must be positive");
  if (input.channels <= 0) throw new Error("Raw PCM channel count must be positive");
  const frameBytes = input.channels * input.bytesPerSample;
  if (input.bytes.byteLength === 0) throw new Error("Raw PCM cannot be empty");
  if (input.bytes.byteLength % frameBytes !== 0) {
    throw new Error(`Raw PCM byte length ${input.bytes.byteLength} is not aligned to ${frameBytes} bytes per frame`);
  }
  return {
    format: "raw",
    sampleRate: input.sampleRate,
    channels: input.channels,
    bytesPerSample: input.bytesPerSample,
    dataBytes: input.bytes.byteLength,
    durationMs: (input.bytes.byteLength / (input.sampleRate * input.channels * input.bytesPerSample)) * 1_000,
  };
};
