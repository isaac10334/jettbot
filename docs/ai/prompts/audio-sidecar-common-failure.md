# Audio Sidecar Common Failure Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready now. This is the next focused audio prompt before broader voice observability or dashboard work.

## Desired Outcome

Fix the common audio failure shared by voice AI chat and YouTube playback by verifying the Discord voice sidecar/Songbird boundary as one vertical slice. Do not treat inbound voice, TTS, and YouTube as unrelated bugs until the shared sidecar join/play/receive behavior is proven.

## Context

Jettbot uses Discord.js for gateway and slash commands, a Rust sidecar with serenity/songbird for Discord voice/audio, AssemblyAI for realtime transcription, ElevenLabs for TTS, and yt-dlp/ffmpeg for YouTube audio preparation. Recent YouTube work produced valid local `pcm_f32le_48000_stereo` audio and emitted sidecar playback events, but live Discord playback still was not audible. Voice AI chat also depends on the same sidecar/Songbird integration for receiving user audio and playing TTS.

Keep IRA boundaries intact: services own domain truth, runtimes own lifecycle/tasks/cleanup, bridges adapt Discord/providers/sidecar, and policies dispatch typed commands. Do not move business logic into Discord handlers or fake success responses.

## Implementation Direction

- Map the shared audio path end to end before changing behavior: `/join`, TypeScript voice state, Rust sidecar session state, Songbird call handler, receive events, playback submission, track events, and Discord audibility.
- Verify `/join` establishes a real Songbird call and that TypeScript voice state reaches connected only after the sidecar emits the corresponding joined event.
- Verify inbound audio: when a real user speaks, the sidecar receives decoded audio, emits `UserAudioChunk`, realtime debug writes `discord-input.wav`, normalization writes `assemblyai-input.wav`, and AssemblyAI receives `16 kHz mono s16le` bytes.
- Verify outbound TTS: `/say` should synthesize ElevenLabs audio, write provider and Discord-input debug artifacts, submit playback to Songbird, emit sidecar playback debug events, and be audible in Discord.
- Verify outbound YouTube: `/youtube` should resolve the media, prepare valid `pcm_f32le_48000_stereo`, send `PlayAudioFile`, emit file playback debug stages, and be audible for the expected duration.
- Add or improve small local verification harnesses around Rust sidecar playback/read behavior before live Discord testing. Focus on format parsing, PCM conversion, raw reader/file input behavior, stream end/stop behavior, and event emission where practical without connecting to Discord.
- Require structured boundary evidence in `logs/realtime/**/text/voice-events.jsonl` and `logs/sidecar.log` for join, receive, normalize, TTS playback, YouTube playback, stop, and error paths.
- Fail fast if required setup is missing or broken: `ffmpeg`, `yt-dlp`, Discord credentials, AssemblyAI credentials, ElevenLabs credentials, Bun dependencies, or the Rust sidecar toolchain.

## Acceptance Checks

- A future agent can tell from logs/artifacts whether the failure is Discord join/session state, sidecar receive decode, normalization, AssemblyAI send, TTS synthesis, Songbird playback submission, track failure, or Discord audibility.
- `/join`, speaking, `/say`, `/youtube`, and `/stop` have live verification notes, or the run stops with a specific setup blocker.
- Prepared debug audio artifacts are valid under ffprobe where applicable, including AssemblyAI `16 kHz mono s16le` WAVs and YouTube `pcm_f32le_48000_stereo` files.
- Focused Bun tests for voice/audio/youtube helpers pass.
- Rust sidecar tests pass through `scripts/sidecar.ps1 test`.
- Full `bun run check` passes if local dependencies and sidecar setup are healthy.
- Do not run `bun dev` as routine verification unless the user explicitly wants a live Discord bot session.
