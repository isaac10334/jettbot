import test from 'node:test';
import assert from 'node:assert/strict';
import { mixPcm16Mono, scalePcm16Mono } from '../src/audio/mix';

const frame = (...samples: number[]) => {
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
    return buffer;
};

test('mixPcm16Mono averages samples across frames', () => {
    const mixed = mixPcm16Mono([frame(1000, -1000), frame(3000, 1000)]);
    assert.equal(mixed.readInt16LE(0), 2000);
    assert.equal(mixed.readInt16LE(2), 0);
});

test('scalePcm16Mono clamps values', () => {
    const scaled = scalePcm16Mono(frame(20_000, -20_000), 2);
    assert.equal(scaled.readInt16LE(0), 32767);
    assert.equal(scaled.readInt16LE(2), -32768);
});
