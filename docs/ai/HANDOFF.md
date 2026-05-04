# Jettbot Handoff

This is the only canonical handoff file. Use it as external project memory: keep current truths, risks, and linked next prompts here; do not turn it into a full command log.

## Current Work Landscape

- Jettbot should become a Discord bot with one shared brain across text and voice: personality, memory, realtime self-awareness, voice-channel awareness, durable event logging, and eventually adaptive behavior.
- YouTube playback works through the WAV path: plain search text resolves through `ytsearch1:`, direct URLs resolve normally, `yt-dlp` downloads `bestaudio`, FFmpeg prepares `audio.wav` as `pcm_s16le` 48 kHz stereo, and the Rust sidecar plays it through Songbird `File` input with Symphonia `pcm`/`wav` features enabled.
- Voice remains the highest-risk product surface after YouTube. The common Rust sidecar/Songbird boundary now has explicit receive state, join/receive/playback debug events, and local tests, but live Discord audibility/receive verification is still blocked by missing runtime credentials in this shell.
- Text context and memory should move toward a database-backed observation log. Discord fetch is for bounded context windows, startup/reconnect backfill, gap repair, and explicit read commands, not the default source of truth on every response.
- Prompt/personality/context assembly is currently too scattered. Future voice and text responses should share one explicit context assembly path.

## Architecture Thesis

- IRA boundaries matter: services own committed domain truth and database writes; runtimes own lifecycle, time, root Run, installed modules, signals, session tasks, and cleanup; bridges adapt Discord, OpenAI, AssemblyAI, yt-dlp, ffmpeg, and the Rust audio sidecar; policies react to signals/runtime state and issue typed service commands.
- Signals are occurrences. Stores are current state. Tasks and runs own async/cancelable work. UI or Discord handlers should render/dispatch only, not own business logic.
- Memory should be layered: raw observation log, episodes, semantic memories, procedural memories, and realtime self-state/body schema.
- Retrieval should start pragmatic: Turso/SQLite indexes plus TypeScript filtering/reranking. Add vector retrieval after the durable event/memory shape is real. Do not start with Vespa or Meilisearch.
- Audio and text logs can contain private Discord data. Any retention, hindsight processing, or user profile work needs explicit deletion, privacy, and storage-cost decisions.

## Primary Prompt Roadmap

Run these prompts in order:

1. [YouTube playback components queue UI](prompts/youtube-playback-components-queue-ui.md) - active follow-up now that playback works: public playback UI, queue, skip, stop-all, and Components V2-style polish.
2. [Audio sidecar common failure](prompts/audio-sidecar-common-failure.md) - local implementation completed for explicit receive enable/disable, structured sidecar boundary evidence, stream/file playback lifecycle events, and focused tests. Live Discord verification is still pending.
3. [Voice pipeline observability/testing](prompts/voice-pipeline-observability-testing.md) - initial local implementation completed for VoiceDebug routing and audio validation helpers; broader live verification is pending.
4. [Memory/database foundation](prompts/memory-database-foundation.md) - build durable observation and memory foundations using Turso/libSQL and a Drizzle-first migration path.
5. [Prompt/personality/context assembly](prompts/prompt-personality-context-assembly.md) - centralize personality and assemble shared text/voice prompt context.
6. [AwarenessRuntime/self-state design](prompts/awareness-runtime-self-state.md) - design realtime self-awareness for prompt context and policies.

## Secondary Prompt Drafts

- [Live voice test](prompts/live-voice-test.md) - still useful when the user can run a short Discord voice session, but the common sidecar failure prompt should come first.
- [Shutdown voice cleanup](prompts/shutdown-voice-cleanup.md) - still useful if shutdown/disconnect behavior remains broken.
- [Image search polish](prompts/image-search-polish.md) - secondary UX polish after the AI/voice/memory roadmap.
- [Memory context layer](prompts/memory-context-layer.md) - retired; its useful intent is folded into the memory/database foundation prompt.

## Risks And Non-Goals

- Do not implement fake features or broad platform scaffolding that is not wired to a working vertical slice.
- Do not flatten this into generic RAG bot advice. Jettbot needs a Discord-native shared brain across text, voice, runtime awareness, and policies.
- Do not introduce large dependencies unless a prompt explicitly asks to evaluate them.
- Do not build a large observability dashboard before structured logs, metrics, traces, and audio artifacts exist.
- Do not treat Discord presence or casual user claims as truth. Presence is a signal with confidence/provenance, and Jettbot should ask clarifying questions when needed.
- `bun dev` connects to Discord. Do not run it as routine verification without the user's explicit intent for a live bot session.

## Recent Verification

- 2026-05-04 audio sidecar/voice observability pass: added sidecar `VoiceDebug` events for join/receive boundaries, made `StartReceive`/`StopReceive` explicit receive-state commands, added stream/file playback lifecycle `PlaybackDebug` stages, stopped treating stream input close as Songbird playback completion, and added f32 file alignment validation before `PlayAudioFile`. TypeScript now routes `VoiceDebug` to `text/voice-events.jsonl`, records join command failures on `VoiceService.state`, and includes local WAV/raw PCM validation helpers. Focused tests passed, full `bun test` passed (`39` tests), `bun run typecheck` passed, `scripts/sidecar.ps1 test` passed (`12` Rust tests), `bun run check` passed, and `bun run sidecar:build` passed cleanly. Live `bun dev`/Discord verification was not run because this shell is missing `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and `AI_GATEWAY_API_KEY`.
- 2026-05-04 YouTube raw playback fix: latest live logs showed `PlaybackDebug stage=end/error` with `DecodeError("no compatible track found")` immediately after `PlayAudioFile`, proving Songbird rejected the seekable `RawAdapter<File>` f32 PCM input. Replaced file playback with a non-seekable `F32FilePlaybackReader` behind `RawAdapter`, added a unit test proving the reader is non-seekable, made TypeScript `playAudioFile` wait for Songbird `playable` or fail fast on `error/end`, and promoted playback playable/error/end debug to the main console. `bun run sidecar:build` passed, `bun run check` passed, and Rust sidecar tests now pass with `13` tests. Needs fresh live `/youtube` verification; expected success signal is `sidecar.playback.debug` with `stage: "playable"` instead of `DecodeError("no compatible track found")`.
- 2026-05-04 YouTube WAV playback rewrite: fresh live logs still showed `DecodeError("no compatible track found")` for `RawAdapter`, so the YouTube file path now prepares `audio.wav` as `pcm_s16le`, `48000Hz`, stereo and sends `wav_pcm_s16le_48000_stereo` to `PlayAudioFile`. The sidecar now validates canonical PCM WAV headers and uses Songbird `File` input for WAV files. Added direct `symphonia = "=0.5.2"` with `pcm` and `wav` features so Songbird's disabled-default Symphonia dependency has the required decoder/format support. Added tests for WAV format parsing, WAV validation, and the ffmpeg WAV prepare command. `bun run sidecar:build` passed and `bun run check` passed with `41` Bun tests and `15` Rust tests. Needs fresh live `/youtube`; expected log should mention `audio.wav`, `format=wav_pcm_s16le_48000_stereo`, `input_created` as `wav file input created`, then `stage: "playable"`.
- 2026-05-04 YouTube WAV validator fix: live run with `weezer sweater song` created a real `audio.wav` at `C:\Users\ijhar\AppData\Local\Temp\jettbot-youtube-KL7yzs\audio.wav` (`48,828,272` bytes). `ffprobe` verified `codec_name=pcm_s16le`, `sample_rate=48000`, `channels=2`, `duration=254.313500`. Sidecar rejected it because the validator assumed `data` was at byte 36; FFmpeg inserted a valid `LIST/INFO` chunk before `data`. Replaced fixed-offset WAV validation with RIFF chunk parsing and added YouTube debug JSONL entries for yt-dlp command/exit, downloaded file stats, ffmpeg command/exit, and prepared WAV stats. `bun run check`, `bun run sidecar:build`, and `cargo fmt --check` passed. Needs fresh live `/youtube`; if it fails, check `text/youtube.jsonl` for `youtube.file.ytdlp.*`, `youtube.file.ffmpeg.*`, `youtube.file.ready` and `text/voice-events.jsonl` for `PlaybackDebug`.
- 2026-05-04 working YouTube playback lesson: the final fix was not “better streaming”; it was using a boring, supported file format and enabling the actual decoder stack. The failed paths were Windows Bun stdin piping, high-frequency IPC PCM chunk streaming, `RawAdapter<File>` f32 PCM, and a too-strict WAV validator. The working path is query/URL resolve with `yt-dlp`, download `bestaudio`, FFmpeg to `audio.wav` (`pcm_s16le`, 48 kHz, stereo), sidecar `PlayAudioFile` with `wav_pcm_s16le_48000_stereo`, RIFF chunk-aware WAV validation, Songbird `File` input, and Symphonia `pcm`/`wav` features. Never regress this back to raw f32 file playback or fixed-offset WAV parsing.
- 2026-05-04 YouTube queue/UI follow-up: completed the embed/button queue UI polish for [YouTube playback components queue UI](prompts/youtube-playback-components-queue-ui.md). `YoutubePlaybackService` owns current item, queue, skip, cancel-all, and sidecar track-end observation; it now keeps status `preparing` until `VoiceService.playAudioFile` confirms Songbird `playable`. `/youtube` enqueues resolved search/URL requests and sends or edits one public playback message with status, duration, queue length, preview, Skip, and Stop All buttons. `/stop` uses the same cancel-all path, and the AI `youtube_audio` tool enqueues instead of directly playing. Verification: `bun run typecheck`, focused YouTube/button tests, `bun test` (`50` tests), Rust sidecar tests (`15` tests), `bun run sidecar:build`, and `bun run check` passed. Live Discord verification was not run.
- 2026-05-04 YouTube fast-track log follow-up: recent logs showed resolve success followed by immediate `youtube.stream.exit` with `ytdlpCode=143` and `ffmpegCode=143`, no `PlaybackChunk`, and immediate `PlaybackFinished`. Root cause was the first streaming pipe path: local `ffmpeg` is `C:\Python313\Scripts\ffmpeg.exe` from 2013 and rejects `-hide_banner`; after removing that, Bun stdin piping still hung on Windows. Hybrid temp-file playback produced a real first PCM chunk in a service smoke test (`2592` bytes), and `bun run check` passed. Live Discord playback still needs a fresh run.
- 2026-05-04 YouTube pacing follow-up: live logs for `weezer sweater song` showed FFmpeg decoded successfully but the bot sent `10835` `PlayAudioStreamChunk` commands and emitted `PlaybackFinished` in about `1.5s` for a `254s` track. Added realtime pacing/coalescing for YouTube PCM playback with about `500ms` lead. `bun run check` passed. Needs another live `/youtube` attempt to verify audible duration.
- 2026-05-04 YouTube sidecar file playback follow-up: latest live retry still did not produce audible playback. Moved YouTube off high-frequency TypeScript IPC streaming by adding sidecar `PlayAudioFile`; TypeScript now prepares `pcm_f32le_48000_stereo` via FFmpeg and sidecar/Songbird reads the file directly. Rebuilt release sidecar with `bun run sidecar:build`; `bun run check` passed. Needs fresh live `/youtube` verification.
- 2026-05-04 YouTube sidecar observability follow-up: `file.ready` occurred and realtime logs did show `PlaybackStarted`, but no audible audio. Verified prepared `audio.f32le` was valid (`254.31s`, `97.6MB`). Added sidecar `PlaybackDebug` events for `PlayAudioFile`: command received, input created, track submitted, Songbird playable/error/end, and a two-second probe; switched file playback to `play_only_input`. Rebuilt release sidecar; `bun run check` passed. Fresh live run should inspect `text/voice-events.jsonl` for `PlaybackDebug` stages.
- 2026-05-04 YouTube fast-track implementation: `bun run typecheck`, focused YouTube tests, full `bun test`, and full `bun run check` passed. Live Discord playback was not run.
- 2026-05-04 roadmap pass: docs-only update completed for `docs/ai/HANDOFF.md` and `docs/ai/prompts/*`; required prompt files and concept references were checked with `rg`.
- Previous known verification: TypeScript typecheck passed, full Bun tests passed, Rust sidecar tests passed, and `bun run check` passed after the audio-first debug implementation.
- `ffprobe` accepted a generated AssemblyAI debug WAV as `pcm_s16le`, `sample_rate=16000`, `channels=1`, `duration=0.100000`.
- Live Discord voice verification is still pending. Do not claim the realtime path is proven until a fresh Discord voice test confirms it.

## Handoff Maintenance Rules

- Keep this file concise and current. Replace stale notes instead of appending a new chronology.
- Put detailed future-work context into a small linked prompt under `docs/ai/prompts/`.
- Every auxiliary agent-memory or prompt file must be linked from this file.
- Summarize meaningful verification. Do not list every touched file or every command; Git and local shell history are better suited for that bookkeeping.
