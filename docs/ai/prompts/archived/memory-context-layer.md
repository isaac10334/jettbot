# Memory Context Layer Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

Retired. Do not run this as the next implementation prompt.

The useful intent from this draft has been folded into [Memory database foundation](memory-database-foundation.md). Follow that prompt instead because the current direction is durable observation logging first, with Discord fetch used only for bounded invocation context, startup/reconnect backfill, missed-gap repair, and explicit read-this-channel/thread commands.

## Preserved Intent

- Jettbot should answer mentions with awareness of recent channel conversation.
- Discord API usage should stay bounded and rate-limit conscious.
- Runtime context and committed memory should remain separate.
- The database log should become the source of truth rather than fetching Discord history for every response.
