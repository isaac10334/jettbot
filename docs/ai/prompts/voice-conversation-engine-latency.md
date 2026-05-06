# Voice Conversation Engine And Latency Prompt

Read `docs/ai/HANDOFF.md`, `docs/ai/ARCHITECTURE.md`, and `docs/ai/audio-debugging-reference.md` first.

## Status

Active.

## Current State

- The realtime voice pipeline has had a proven live success: known-user AssemblyAI transcript -> LLM -> ElevenLabs PCM -> sidecar playback.
- `ConversationEngineRuntime` owns deterministic decisions and speech state.
- Per-guild TTS playback is serialized and different guilds can proceed independently.
- Unknown SSRC transcripts remain diagnostic-only.
- Direct-address aliases include observed STT variants such as `Jebba`, `Jepa`, and `J-Pod`.
- TTS still starts after final structured LLM output. Do not claim true partial LLM-to-TTS streaming yet.

## Next Work

- Run a fresh live voice regression with current memory/personality code.
- Measure and log the full latency chain:
  - transcript final -> decision
  - decision -> LLM start
  - LLM start -> first text partial
  - LLM final -> TTS request
  - TTS first provider chunk -> sidecar playable
  - playable -> playback end
- Improve sparse turn-taking: Jettbot should listen more than he talks, but answer strongly when clearly addressed.
- Consider a fast structured LLM decider only after deterministic behavior remains stable in live use.

## Guardrails

- Conversation engine decides `ignore`, `wait`, `speak`, `queueSpeech`, `interruptSelf`, `refuseInterruption`, and `updateWorkingContext`.
- Response generation writes text only.
- Speech playback owns ElevenLabs and sidecar interaction.
- Do not put episode/story generation in realtime voice control.

## Acceptance Checks

- `bun run voice:analyze -- --skip-tool-versions` reports `Playback overlap: overlappingStreams=0` for a fresh single-guild Jettbot speech run.
- Known multi-user transcripts keep speaker labels in the decision window.
- Stop/cancel speech commands interrupt safely.
- Focused voice/conversation tests, `bun run typecheck`, and `bun run check` pass.
