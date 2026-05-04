# Jettbot Architecture

Jettbot follows Installed Runtime Architecture.

## Goal

Jettbot is a high-tech Discord bot that can join voice, speak, transcribe users separately, remember useful facts, call tools, and respond with a configurable personality. It should not behave like an all-seeing message scraper: normal AI response paths should require a mention, voice/session context, slash command, or explicit feature trigger such as `.img`.

## IRA Boundaries

- Services own domain truth and expose explicit methods/stores/signals.
- Runtimes own lifecycle, installs, tasks, cancellation, and cleanup.
- Bridges and policies connect services to Discord, the Rust sidecar, AI, memory, TTS, and transcription.
- Signals are occurrences; stores are current state.
- React/UI code is not currently present. If added later, UI components should render state and dispatch commands only.

## Current Runtime

`apps/bot/src/app/AppRuntime.ts` creates one app runtime with `@loop-kit/common/Runtime`.

Installers attach long-lived behavior:

- `installObservability`
- `installShutdownHandlers`
- `installMemoryEffects`
- `installRustSidecarBridge`
- `installRealtimeDebugBridge`
- `installDiscordGateway`
- `installDiscordCommands`
- `installVoiceSessionPolicy`
- `installTranscriptionPipeline`
- `installAiResponsePolicy`
- `installTtsPlaybackPipeline`
- `installDiscordVoiceCommandPolicy`
- `installDiscordImagePolicy`
- `installDiscordMessagePolicy`

## Feature Pattern

Prefer vertical feature slices that preserve IRA boundaries:

- Domain services own capability and state. Example: `ImageSearchService`, `ImageRateLimitService`, `ImageSearchSessionService`.
- Tools are thin AI-callable adapters over services. Example: `image_search` wraps `ImageSearchService`.
- Policies/installers wire triggers to capabilities. Example: `installDiscordImagePolicy` listens to `.img`, `/img`, and image paging buttons.
- Discord-specific parsing/rendering belongs in Discord policies, not services or tools.
- App runtime installs policies because most features cross domains: Discord, AI, memory, metrics, tools, voice, or sidecar.

Use a dedicated domain folder for real capabilities (`image`, `memory`, `voice`, `youtube`) rather than a broad `features` folder unless adding a manifest/registry layer later.

## Discord Surfaces

Discord gateway and command registration are handled with `discord.js`.

- Text commands are special-case triggers and should stay narrow.
- Slash commands are defined in `apps/bot/src/discord/DiscordCommands.ts`.
- Button/component interactions are exposed by `DiscordService.buttonInteractions`.
- Do not use `@discordjs/voice`; Discord audio belongs to the Rust sidecar using serenity/songbird.

Run `bun run discord:commands:refresh` to clear and re-register slash commands for the configured guild or global application scope.

## Tools

`ToolService` owns the local tool registry. A tool should be platform-neutral and should not know about Discord message objects, interaction replies, or UI rendering. It may call a domain service and return structured data for AI or command policies.

## Speech And Memory Direction

AssemblyAI is used for realtime speech-to-text. Its promptable transcription is important for Jettbot: user memory and per-user context can later be fed into STT prompts to improve recognition of names, game terms, group slang, and user-specific lingo. The architecture should preserve per-user transcription/stitching and authorization context so tool calls can be evaluated against who actually spoke.

## Current External APIs/SDKs

- Discord API through `discord.js` for gateway events, slash commands, and message components.
- Rust sidecar with serenity/songbird for Discord voice/audio.
- AssemblyAI for realtime transcription.
- ElevenLabs for TTS.
- Vercel AI Gateway / AI SDK for LLM calls.
- Turso/libSQL for memory storage.
- Brave Search API for image search.
- yt-dlp and ffmpeg for YouTube/audio utilities.

## Observability

`LoggingService` creates the app `console` using `@loop-kit/common/Console`, with native console output plus a newest-first JSONL file output.

The Rust voice sidecar is treated as an external runtime behind `RustSidecarService`. Raw sidecar stderr is written to a separate append-only file, while only lines at or above `JETTBOT_SIDECAR_CONSOLE_LEVEL` are promoted into the app console. This keeps Serenity/Songbird trace noise inspectable without flooding `bun dev`.

`MetricsService` keeps in-process counters and timing summaries, then periodically snapshots them to JSON. Metrics are intentionally cheap: command paths increment counters and record duration without awaiting disk writes.

`RealtimeDebugCaptureService` is an observability bridge for difficult voice and streaming behavior. It creates one local folder per joined voice session under `JETTBOT_REALTIME_DEBUG_DIR`, using readable local-time folder names such as `5-2-26_11-02-AM_<guild>_<channel>_<session>`. Runtime policies can write boundary artifacts there without owning file layout:

- `audio/users/<userId>/discord-input.wav` for PCM chunks emitted by the sidecar.
- `audio/users/<userId>/assemblyai-input.wav` for the normalized bytes sent to AssemblyAI. Discord receive audio is converted from 48 kHz stereo PCM s16le to 16 kHz mono PCM s16le first.
- `audio/tts/<streamId>-elevenlabs-output.<ext>` for TTS provider audio chunks.
- `audio/tts/<streamId>-discord-input.<ext>` for audio chunks sent to the sidecar for playback. The first supported playback path uses ElevenLabs `pcm_24000`; the Rust sidecar converts PCM s16le chunks to f32 samples for Songbird `RawAdapter`.
- `text/*.jsonl` and `text/*.txt` for voice events, transcript turns, LLM request messages, token streams, responses, and TTS phrase metadata.

Default files:

- `./logs/jettbot.log.jsonl`
- `./logs/sidecar.log`
- `./logs/realtime/<voice-session>/...`
- `./logs/metrics.json`

TUI note: Rezi may be a good future bridge surface for runtime/log inspection, but it should stay outside service business logic. If added, wire it as a bridge/adapter over existing logging, metrics, services, runtimes, and signals rather than routing domain behavior through TUI widgets.
