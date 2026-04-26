# AGENTS.md

This file documents how to work in this repository today.

## Current status

- The repo currently runs a Discord voice loopback bot.
- The previous actor-system rewrite was removed because it was half-migrated, stale, and blocking compilation.
- `src/index.ts` and `src/loopback.ts` both boot the same runtime.
- The main architecture now centers on:
  - `src/app/config.ts` for validated environment/config loading
  - `src/app/services.ts` for service wiring and startup tasks
  - `src/app/state.ts` for in-memory bot state
  - `src/app/logging.ts` for structured JSON logging and simple spans
  - `src/bot/VoiceSessionActor.ts` and `src/bot/UserTrackActor.ts` for Discord voice loopback behavior

## Common commands

- Install deps: `pnpm install`
- Run bot: `pnpm dev`
- Alternate entrypoint: `pnpm bot`
- Typecheck: `pnpm check`
- Test: `pnpm test`
- Build: `pnpm build`

## Environment

Required:

- `DISCORD_TOKEN`
- `GUILD_ID`
- `VOICE_CHANNEL_ID`

Optional:

- `DEBUG=1` enables more verbose track/session logging
- `LOG_LEVEL=debug|info|warn|error`
- `TARGET_FRAMES`
- `MAX_FRAMES`
- `RESUBSCRIBE_AFTER_MS`
- `JETTBOT_E2E=1` enables the live Discord smoke test when the required Discord env vars are present

## How the repo works

1. `src/app/run.ts` loads env and starts the bot through a lazy startup task.
2. `src/app/services.ts` builds the runtime using an explicit services/deps pattern.
3. Discord login and voice connection happen before the session starts.
4. `VoiceSessionActor` owns per-user `UserTrackActor` instances and the output mixer.
5. Each `UserTrackActor` subscribes to Discord Opus, decodes to PCM, downmixes to mono, and pushes frames into a jitter buffer.
6. `VoiceSessionActor` pulls frames every 20ms, mixes active speakers, converts mono back to stereo, encodes Opus, and sends audio back to Discord.
7. `src/app/state.ts` keeps client in-memory state separate from external state:
   - `client`: runtime status, loopback mode, track stats, output rate
   - `external`: guild/channel identity and observed connected member ids

## Design rules

- Prefer simple service composition over hidden global state.
- Keep client state in memory and explicit.
- Keep external state separate from client state.
- Treat Discord, persistence, and future agent backends as services, not ambient singletons.
- Use Evolu-style dependency injection:
  - dependencies first
  - arguments second
  - execution context last
- Prefer `Result` and `Task`-style flows for recoverable errors and startup/shutdown work.
- Do not reintroduce EffectTS here unless there is a concrete problem it solves better than plain TypeScript plus explicit services.

## Evolu guidance

- This repo depends on `@evolu/common`.
- Use its `Result` and `Task` type shapes as the default contract for fallible and lazy async operations.
- Keep usage practical. Boundary code should fail fast with typed errors rather than throw deep inside the app.
- If you want more helpers, add them behind local wrappers in `src/app/fp.ts` so runtime compatibility stays under control.
- Reference: `https://www.evolu.dev/docs/dependency-injection`

## Testing story

Current tests:

- `tests/config.test.ts` covers config validation
- `tests/mix.test.ts` covers PCM mixing helpers
- `tests/pcmJitterBuffer.test.ts` covers jitter buffering behavior
- `tests/discord-live.e2e.test.ts` is an opt-in live smoke test for Discord credentials and channel join flow

When adding code:

- Add focused unit tests for audio transforms, state transitions, and config parsing.
- Keep live integration tests opt-in and environment-gated.
- Prefer extracting logic into service functions or small pure helpers before adding more class complexity.

## Debugging story

- Logs are structured JSON via `src/app/logging.ts`.
- Use logger children with stable fields like `userId`, `guildId`, `voiceChannelId`, and event names.
- Keep operational telemetry in `src/app/state.ts` so runtime snapshots can be printed or persisted later.
- If debugging gets harder again, add:
  - a periodic state dump command
  - trace ids for join/resubscribe/mix cycles
  - persisted telemetry using Turso

## Near-term architecture direction

- If persistence is added, prefer Turso for bot memory, event logs, and durable debugging artifacts.
- If durable scheduling/concurrency replaces the current session orchestration, evaluate Resonate as the execution layer instead of reviving the deleted custom actor runtime.
- Do not start that migration until the loopback bot stays green under `pnpm check` and `pnpm test`.
