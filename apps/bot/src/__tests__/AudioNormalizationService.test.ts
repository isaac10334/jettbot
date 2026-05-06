import { describe, expect, test } from "bun:test";
import { createAudioNormalizationService, __audioNormalizationTestUtils } from "../audio/AudioNormalizationService";

const stereoFrame = (left: number, right: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  __audioNormalizationTestUtils.writeInt16Le(bytes, 0, left);
  __audioNormalizationTestUtils.writeInt16Le(bytes, 2, right);
  return bytes;
};

const concat = (...chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

describe("AudioNormalizationService", () => {
  test("downmixes 48k stereo s16le to 16k mono s16le", () => {
    const normalizer = createAudioNormalizationService().createAssemblyAiNormalizer();
    const input = concat(stereoFrame(300, 900), stereoFrame(300, 900), stereoFrame(300, 900));
    const output = normalizer.normalize(input, { sampleRate: 48000, channels: 2 });

    expect(output.sampleRate).toBe(16000);
    expect(output.channels).toBe(1);
    expect(output.inputFrameCount).toBe(3);
    expect(output.outputFrameCount).toBe(1);
    expect(__audioNormalizationTestUtils.readInt16Le(output.bytes, 0)).toBe(600);
  });

  test("preserves resampling carryover across chunks", () => {
    const normalizer = createAudioNormalizationService().createAssemblyAiNormalizer();
    const first = normalizer.normalize(concat(stereoFrame(300, 300), stereoFrame(600, 600)), { sampleRate: 48000, channels: 2 });
    const second = normalizer.normalize(stereoFrame(900, 900), { sampleRate: 48000, channels: 2 });

    expect(first.outputFrameCount).toBe(0);
    expect(second.outputFrameCount).toBe(1);
    expect(__audioNormalizationTestUtils.readInt16Le(second.bytes, 0)).toBe(600);
  });
});
