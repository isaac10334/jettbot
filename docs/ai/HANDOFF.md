# Jettbot Handoff

This is the canonical project memory for the next agent. Keep it concise: current state, important truths, active risks, and where to continue.

## Current State

- Jettbot is a Discord bot with text, YouTube playback, image search, realtime voice receive/transcription, LLM response generation, ElevenLabs TTS, and Rust sidecar Discord audio through serenity/songbird.
- The working YouTube path is intentionally boring and reliable: `yt-dlp` -> FFmpeg `audio.wav` (`pcm_s16le`, 48 kHz, stereo) -> sidecar `PlayAudioFile` -> Songbird `File` input. Do not regress this to raw f32 file playback, fixed-offset WAV parsing, or high-frequency TypeScript IPC streaming.
- Voice has had a proven live end-to-end success: known-user AssemblyAI transcript -> LLM -> ElevenLabs PCM -> sidecar playback. Current code serializes Jettbot speech per guild and waits for sidecar playback end.
- `ConversationEngineRuntime` owns deterministic voice decisions and speech state. Unknown SSRC transcripts are diagnostic-only. Direct-address aliases include observed STT variants like `Jebba`, `Jepa`, and `J-Pod`.
- Memory uses Turso/libSQL through `@libsql/client` with Drizzle schema/migration files. If Turso env vars are absent, it falls back to local `file:jettbot-memory.db`.
- Memory layers now exist for raw observations, episodes, semantic memories, procedural memories, self-state, personality settings, legacy messages, transcript turns, and tool events.
- Text-channel memory caches all non-empty user messages plus Jettbot's own bot messages if seen through the gateway. It dedupes by Discord snowflake, fetches 10 prior messages when a channel is first seen, fills at most 100 missed messages for known channels, and stores per-channel cursors in `self_state`.
- Prompt assembly is centralized in `ConversationService` for text mentions and voice predicted-turn prompts. It includes active personality, scoped memory, cached channel context for text, stitched transcript context for voice, and self-state.
- Personality now has a DB-backed durable character state stored in `self_state` through `PersonalityService`. Shared prompt assembly includes it for both text and voice as emotional continuity: summary, mood, disposition, grudges, and attachments. Admins can inspect or seed it with `/personality state` and `/personality set-state`.
- AssemblyAI streaming sessions now send the configured `ASSEMBLYAI_TRANSCRIPTION_PROMPT` on connection when non-empty and log prompt length/hash/preview to realtime debug transcription session JSONL.
- Current default personality is `unhinged_gremlin`; selectable profiles also include `dry_menace`, `edgy_roaster`, and `chaotic_character`. `/memory` and `/personality` are admin-only through `ADMIN_USER_ID`.

## Active Prompts

1. [Memory database foundation](prompts/memory-database-foundation.md) - continue live Turso verification, edit/delete observations, channel cursor inspection, and eventual episode generation.
2. [Prompt/personality/context assembly](prompts/prompt-personality-context-assembly.md) - improve personality profiles, prompt precedence, warnings, and richer context packets.
3. [Voice conversation engine and latency](prompts/voice-conversation-engine-latency.md) - run fresh live voice regression, measure latency, and improve sparse turn-taking.
4. [AwarenessRuntime self-state](prompts/awareness-runtime-self-state.md) - design runtime-owned awareness snapshot for prompt assembly and policies.
5. [Live voice regression](prompts/live-voice-test.md) - checklist for intentional live Discord voice testing.

## On Hold

- [YouTube loading latency and streaming](prompts/on-hold/youtube-loading-latency-streaming.md) - YouTube playback works; only resume if startup latency becomes a real problem.
- [Observability dashboard](prompts/on-hold/observability-dashboard.md) - logs/scripts are enough for now; resume when there is a clear operator workflow.

## Architecture Truths

- IRA boundaries matter: services own committed domain truth and database writes; runtimes own lifecycle, tasks, cancellation, cleanup, and installed modules; bridges adapt Discord/OpenAI/AssemblyAI/ElevenLabs/yt-dlp/FFmpeg/sidecar; policies react to signals and issue typed service commands.
- Signals are occurrences. Stores are current state. Tasks/runs own async and cancelable work.
- The conversation engine decides whether/how to speak; response generation writes text; the speech controller owns ElevenLabs and sidecar playback.
- Retrieval should stay pragmatic: scoped SQL filters plus TypeScript reranking before vectors or lexical search.
- Audio, transcripts, logs, and cached Discord messages can contain private data. Any retention/deletion/user-profile work needs explicit privacy decisions.

## Recent Verification

- 2026-05-07 character continuity slice: focused `bun test apps/bot/src/__tests__/PersonalityPromptService.test.ts` passed, `bun run typecheck` passed, and full `bun test` passed (`102` tests). Rust sidecar tests, Discord slash command refresh, live text mention, and live voice verification were not run.
- 2026-05-06 STT prompt observability slice: focused `bun test apps/bot/src/__tests__/TranscriptionPipeline.test.ts` passed and `bun run typecheck` passed. Full test suite and live Discord/AssemblyAI verification were not run.
- 2026-05-06 text-channel memory continuation: focused Discord channel memory / memory / prompt tests passed, `bun run typecheck` passed, full `bun test` passed (`100` tests), and full `bun run check` passed (`100` Bun tests and `23` Rust tests). Live Discord/Turso verification was not run.
- 2026-05-06 memory/personality/conversation slice: focused memory/conversation/personality tests passed, `bun run typecheck` passed, full `bun test` passed (`95` tests), and full `bun run check` passed (`95` Bun tests and `23` Rust tests). Discord slash command refresh and live voice verification were not run.
- Latest proven live voice success remains the 2026-05-05 8:16 PM realtime session. Run a fresh live regression before claiming the current memory/personality code is proven in voice.

## Risks

- `bun dev` connects to Discord. Do not run it casually.
- Drizzle migration files exist, but runtime still creates/repairs schema defensively. Keep both paths aligned.
- Do not index entire historical Discord channels. Keep bounded prelude/gap repair behavior unless a new privacy/storage design explicitly changes it.
- Do not build the dashboard or YouTube streaming rewrite while memory/personality/voice quality is the active priority.
