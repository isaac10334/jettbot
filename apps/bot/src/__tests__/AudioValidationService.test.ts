import { describe, expect, test } from "bun:test";
import { validatePcmS16leWav, validateRawPcm } from "../audio/AudioValidationService";

const wav = (input: { readonly sampleRate: number; readonly channels: number; readonly dataBytes: number }): Uint8Array => {
  const bytes = new Uint8Array(44 + input.dataBytes);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + input.dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * input.channels * 2, true);
  view.setUint16(32, input.channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, input.dataBytes, true);
  return bytes;
};

describe("AudioValidationService", () => {
  test("validates canonical PCM s16le wav metadata", () => {
    expect(validatePcmS16leWav(wav({ sampleRate: 16000, channels: 1, dataBytes: 3200 }))).toEqual({
      format: "wav",
      audioFormat: 1,
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 3200,
      durationMs: 100,
    });
  });

  test("validates raw f32le stereo alignment and duration", () => {
    expect(validateRawPcm({
      bytes: new Uint8Array(48_000 * 2 * 4),
      sampleRate: 48_000,
      channels: 2,
      bytesPerSample: 4,
    })).toEqual({
      format: "raw",
      sampleRate: 48_000,
      channels: 2,
      bytesPerSample: 4,
      dataBytes: 384_000,
      durationMs: 1_000,
    });
  });

  test("rejects misaligned raw pcm", () => {
    expect(() => validateRawPcm({
      bytes: new Uint8Array(6),
      sampleRate: 48_000,
      channels: 2,
      bytesPerSample: 4,
    })).toThrow("not aligned");
  });
});
