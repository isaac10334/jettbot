# Voice Conversation Engine And Latency Prompt

Read `docs/ai/HANDOFF.md`, `docs/ai/ARCHITECTURE.md`, and `docs/ai/audio-debugging-reference.md` first.

## Goal

Improve Jettbot's realtime voice conversation quality without building a large memory system yet. The active priority is turn-taking, latency, per-guild speech serialization, and multi-user correctness.

## Current State

- The 2026-05-05 8:16 PM live run proved the full voice pipeline works.
- That same run showed overlapping Jettbot playback streams. The first fix added `ConversationEngineRuntime`, deterministic decisions, and per-guild TTS queueing that waits for playback end.
- Current LLM partials are logged, but TTS starts after the final structured LLM response. Do not claim true partial LLM -> TTS streaming until implemented and measured.

## Implementation Direction

- Keep all transcript and voice-related events flowing through `ConversationEngineRuntime`.
- Preserve the separation:
  - conversation engine decides: `ignore`, `wait`, `speak`, `queueSpeech`, `interruptSelf`, `refuseInterruption`, `updateWorkingContext`
  - response model writes Jettbot text
  - speech controller serializes ElevenLabs and sidecar playback
- Improve deterministic turn-taking before adding a fast LLM decider:
  - direct address to Jettbot may speak
  - stop/cancel/shut up while speaking interrupts
  - multiple known users in a short window should wait
  - unknown SSRC remains diagnostic-only
  - never blindly answer every final transcript
- Add a fast structured LLM decider only after deterministic tests pass. It must return structured decisions only and must not call TTS, Discord, or the sidecar.
- Keep story/episode generation out of realtime control. Episodes belong to a later background memory pass.

## Latency Targets To Measure

- transcript final -> decision start
- decision start -> decision finish
- decision finish -> response LLM start
- response LLM start -> first text partial
- response LLM final -> TTS request
- TTS request -> first provider chunk
- first provider chunk -> sidecar playable
- sidecar playable -> playback end

## Acceptance Checks

- `bun run voice:analyze -- --skip-tool-versions` reports `Playback overlap: overlappingStreams=0` for a new single-guild Jettbot speech run.
- Two speech requests in the same guild do not overlap; different guilds can proceed independently.
- Known multi-user transcripts keep speaker labels in the stitched context and decision window.
- Stop/cancel speech commands interrupt safely.
- Focused voice/conversation tests, `bun run typecheck`, and `bun run check` pass.
