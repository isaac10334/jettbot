# Live Voice Test Prompt Draft

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready when the user can run a short live Discord voice session.

## Desired Outcome

Validate the realtime voice path end to end with fresh processes and current code.

## Context

The current pipeline normalizes Discord receive audio from 48 kHz stereo PCM s16le to 16 kHz mono PCM s16le for AssemblyAI, prevents duplicate per-user STT sessions, writes active readable WAV files, and plays ElevenLabs `pcm_24000` streams through the Rust sidecar.

Realtime debug artifacts should appear under `logs/realtime/<session>/`, including `text/audio-events.jsonl`, `text/audio-summary.jsonl`, `text/transcription-sessions.jsonl`, `text/transcripts.jsonl`, `text/voice-events.jsonl`, and TTS files.

## Constraints

- Stop old `bun` and `jettbot-voice-sidecar` processes before testing.
- Do not rewrite the architecture during this prompt.
- Treat live Discord connection as intentional user-assisted verification.

## Acceptance Checks

- One user speaking does not create duplicate AssemblyAI sessions.
- Raw Discord WAV is 48 kHz stereo PCM.
- AssemblyAI WAV is 16 kHz mono PCM and playable while the session is active.
- Transcripts arrive for spoken audio.
- A Jettbot response emits playback chunk and finish events.
- `logs/sidecar.log` has no unexplained receive decode or playback errors.
