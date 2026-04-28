# Jettbot Architecture

Jettbot follows Installed Runtime Architecture.

- Services own domain truth and expose explicit methods/stores/signals.
- Runtimes own lifecycle, installs, tasks, cancellation, and cleanup.
- Bridges and policies connect services to Discord, the Rust sidecar, AI, memory, TTS, and transcription.
- React/UI code is not currently present. If added later, UI components should render state and dispatch commands only.

## Current Runtime

`apps/bot/src/app/AppRuntime.ts` creates one app runtime with `@loop-kit/common/Runtime`.

Installers attach long-lived behavior:

- `installObservability`
- `installShutdownHandlers`
- `installMemoryEffects`
- `installRustSidecarBridge`
- `installDiscordGateway`
- `installDiscordCommands`
- `installVoiceSessionPolicy`
- `installTranscriptionPipeline`
- `installAiResponsePolicy`
- `installTtsPlaybackPipeline`
- `installDiscordVoiceCommandPolicy`
- `installDiscordMessagePolicy`

## Observability

`LoggingService` creates the app `console` using `@loop-kit/common/Console`, with native console output plus a newest-first JSONL file output.

`MetricsService` keeps in-process counters and timing summaries, then periodically snapshots them to JSON. Metrics are intentionally cheap: command paths increment counters and record duration without awaiting disk writes.

Default files:

- `./logs/jettbot.log.jsonl`
- `./logs/metrics.json`
