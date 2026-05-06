# Voice Pipeline Observability And Testing Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

Archived. The core observability/testing work is implemented through realtime debug capture, voice analyzers, focused tests, and sidecar diagnostics. Use `../live-voice-test.md` or `../voice-conversation-engine-latency.md` for active voice work.

## Desired Outcome

Debug, bulletproof, and instrument the voice pipeline so failures are visible at the right boundary and audio correctness can be tested without relying only on live Discord sessions.

## Context

Jettbot uses Discord.js for gateway/commands, a Rust sidecar with serenity/songbird for Discord audio, AssemblyAI for realtime transcription, ElevenLabs for TTS, and local realtime debug capture under `logs/realtime/<session>/`. The architecture should stay IRA-shaped: services own domain truth, runtimes own lifecycle/tasks/cleanup, bridges adapt external systems, and policies dispatch typed commands.

## Implementation Direction

- Map the voice path end to end: Discord command/policy, voice session runtime, Rust sidecar bridge, receive audio, normalization, AssemblyAI sessions, transcript stitching, AI response, TTS stream, and sidecar playback.
- Clarify service/runtime boundaries before changing behavior. Do not move business logic into Discord handlers.
- Improve structured logs, metrics, and trace IDs across session/user/stream boundaries. Include first audio chunk, stream close, cancellation, provider failures, sidecar errors, and duplicate-session prevention.
- Extend realtime debug artifacts only where they reveal real boundary behavior. Do not build a large dashboard until logs, metrics, and artifact capture are reliable.
- Add testable component boundaries for decode/normalize/stitch/playback orchestration without live Discord.
- Add audio validation using ffmpeg/ffprobe where practical: container/codec/sample-rate/channel checks, decoded PCM comparison, duration drift, silence/dropout detection, clipping checks, RMS/SNR/max-error checks, and later perceptual metrics if needed.
- Keep privacy and retention explicit. Voice artifacts may contain private audio/transcripts and must remain ignored/local unless a later prompt designs retention.

## Acceptance Checks

- A future agent can identify which boundary failed from logs/artifacts without guessing.
- Tests cover high-risk orchestration and audio validation helpers without connecting to Discord.
- Realtime debug WAVs remain inspectable while sessions are active.
- Existing live voice behavior is preserved or improved.
- Typecheck and focused tests pass. Do not run `bun dev` unless the user explicitly wants a live Discord session.
