import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/app/config';

test('readConfig parses required env vars and defaults', () => {
    const result = readConfig({
        DISCORD_TOKEN: 'token',
        GUILD_ID: 'guild',
        VOICE_CHANNEL_ID: 'voice',
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.discordToken, 'token');
    assert.equal(result.value.logLevel, 'info');
    assert.equal(result.value.targetFrames, 25);
    assert.equal(result.value.maxFrames, 200);
    assert.equal(result.value.resubscribeAfterMs, 2_000);
});

test('readConfig rejects invalid numeric env vars', () => {
    const result = readConfig({
        DISCORD_TOKEN: 'token',
        GUILD_ID: 'guild',
        VOICE_CHANNEL_ID: 'voice',
        TARGET_FRAMES: 'abc',
    });

    assert.equal(result.ok, false);
    if (result.ok) return;

    assert.equal(result.error.type, 'InvalidEnvVar');
    assert.equal(result.error.key, 'TARGET_FRAMES');
});
