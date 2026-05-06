# Live Voice Regression Prompt

Read `docs/ai/HANDOFF.md` and `docs/ai/audio-debugging-reference.md` first.

## Status

Regression checklist for the next intentional live Discord voice run.

## Goal

Verify the current voice stack after memory/personality changes:

Discord receive -> known-user AssemblyAI transcript -> conversation decision -> shared prompt assembly -> LLM response -> ElevenLabs PCM -> sidecar playback.

## Preflight

- Run `bun run check`.
- Run `bun run voice:cleanup-logs` if old realtime sessions make inspection noisy.
- Do not run `bun dev` unless a live Discord session is intended.
- Stop immediately if required env vars, sidecar build, ffmpeg/ffprobe, AssemblyAI, ElevenLabs, or AI Gateway are unavailable.

## Live Checks

- `text/transcription-sessions.jsonl` shows AssemblyAI `open`, `Begin`, `SpeechStarted`, and `Turn`.
- `text/transcripts.jsonl` has at least one final turn with a real Discord user ID.
- `text/stitched-transcripts.jsonl` preserves speaker labels.
- `text/conversation-engine.jsonl` shows expected sparse decisions.
- A direct address such as `J-Pod, are you here?` reaches LLM/TTS.
- `text/llm-messages.jsonl` includes personality and recent context.
- `text/tts.jsonl` shows effective `pcm_24000` for sidecar stream playback.
- `text/voice-events.jsonl` shows playback start/playable/end.
- `bun run voice:analyze -- --skip-tool-versions` reports no missing stages and `Playback overlap: overlappingStreams=0`.

## Guardrails

- Unknown SSRC transcripts are diagnostic-only and must not trigger memory, LLM, or TTS.
- Do not debug YouTube here unless it blocks voice regression.
- `bun run check` must pass after any local changes made during the run.
