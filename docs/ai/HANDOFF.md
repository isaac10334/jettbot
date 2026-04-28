# Handoff

## 2026-04-28 Observability and Discord Reply Flags

### What Changed

- Replaced deprecated Discord interaction `{ ephemeral: true }` usage with `flags: MessageFlags.Ephemeral`.
- Added `LoggingService` using `@loop-kit/common/Console` with native console output plus newest-first JSONL file output.
- Added `MetricsService` with counters and timing summaries, flushed periodically to JSON.
- Wired observability into `createAppServices` before other services so `runtime.run` receives the app console through runtime deps.
- Captured Rust sidecar stderr through the app logger instead of inheriting it directly.
- Added command and sidecar call metrics for started/completed/failed counts and duration summaries.
- Created lightweight `docs/ai/ARCHITECTURE.md` and `docs/ai/UI_GUIDE.md` because they were missing.

### Files Touched

- `apps/bot/src/Env.ts`
- `apps/bot/src/app/AppRuntime.ts`
- `apps/bot/src/app/AppServices.ts`
- `apps/bot/src/main.ts`
- `apps/bot/src/discord/installDiscordVoiceCommandPolicy.ts`
- `apps/bot/src/sidecar/RustSidecarService.ts`
- `apps/bot/src/observability/LoggingService.ts`
- `apps/bot/src/observability/MetricsService.ts`
- `apps/bot/src/observability/installObservability.ts`
- `apps/bot/src/__tests__/MemoryService.test.ts`
- `docs/ai/ARCHITECTURE.md`
- `docs/ai/UI_GUIDE.md`
- `docs/ai/HANDOFF.md`

### Commands Run

- `bun run typecheck`
- `bun test`
- `bun run check`

### Passed

- TypeScript typecheck passed.
- Bun test suite passed: 10 tests, 0 failures.
- Full project check passed, including Rust sidecar unit tests: 4 tests, 0 failures.

### Failed Or Skipped

- Live `bun dev` was not run because it would connect to Discord and requires the user's live environment.

### Log Diagnosis

- The long startup block in the user's pasted output is Rust sidecar/Serenity/Songbird debug tracing from `RUST_LOG=debug`, not a crash.
- The bot reached Discord Ready and emitted `jettbot.started`.
- The actual warning was from discord.js 14.26.3: interaction response option `ephemeral` is deprecated and should be replaced with `flags`.

### Next Recommended Task

Add focused metrics around the latency-sensitive audio path: voice join time, receive startup time, transcription chunk latency, TTS generation duration, TTS first-byte time, playback queue depth, and playback underruns once those signals exist in the sidecar protocol.
