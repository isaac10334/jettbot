import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunBotTask } from '../src/app/services';

const shouldRun =
    process.env.JETTBOT_E2E === '1' &&
    !!process.env.DISCORD_TOKEN &&
    !!process.env.GUILD_ID &&
    !!process.env.VOICE_CHANNEL_ID;

test('discord loopback boot smoke test', { skip: !shouldRun }, async () => {
    const result = await createRunBotTask({ env: process.env })();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const runtime = result.value;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const snapshot = runtime.state.getSnapshot();

    assert.equal(snapshot.client.status, 'running');
    assert.equal(snapshot.external.guildId, process.env.GUILD_ID);

    await runtime.stop();
});
