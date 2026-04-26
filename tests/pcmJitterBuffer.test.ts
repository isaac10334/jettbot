import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmJitterBuffer } from '../src/audio/pcmJitterBuffer';

test('PcmJitterBuffer primes after targetFrames and reverts on underflow', () => {
    const buffer = new PcmJitterBuffer({ targetFrames: 2, maxFrames: 4 });

    buffer.push(Buffer.alloc(2));
    assert.equal(buffer.isPrimed(), false);
    assert.equal(buffer.popTick(), null);

    buffer.push(Buffer.alloc(2));
    assert.equal(buffer.isPrimed(), true);
    assert.notEqual(buffer.popTick(), null);
    assert.notEqual(buffer.popTick(), null);
    assert.equal(buffer.popTick(), null);
    assert.equal(buffer.isPrimed(), false);
});
