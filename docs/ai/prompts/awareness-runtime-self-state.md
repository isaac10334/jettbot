# AwarenessRuntime Self-State Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

Active next-design prompt.

## Current State

- Durable `self_state` storage exists in the memory foundation.
- Prompt assembly can read a compact `runtime` self-state snapshot, but no dedicated `AwarenessRuntime` owns that snapshot yet.
- Current voice and Discord policies still infer most runtime awareness from local service state.

## Desired Outcome

Add an IRA-aligned runtime that tracks Jettbot's current body/schema state and exposes compact snapshots to prompt assembly and policies.

## State To Track

- Connected guilds, text channels, threads, and voice sessions.
- Users currently speaking and recently active participants.
- Whether Jettbot is thinking, speaking, queued, interrupted, or idle.
- Active jobs, tool calls, playback streams, transcription sessions, and cancellation handles.
- Recent provider/runtime/Discord/sidecar failures.
- Active personality profile.
- Transcription hints: names, games, project terms, slang, and pronunciation/context clues.

## Guardrails

- Self-state is current runtime truth, not permanent semantic memory.
- Persist significant state changes as raw observations only when they matter historically.
- Include provenance/confidence for inferred or unreliable signals.
- Policies should react to awareness stores/signals, not scrape logs.

## Acceptance Checks

- Snapshot shape is explicit and consumed by prompt assembly.
- State resets cleanly on session end and shutdown.
- Focused state/snapshot tests and `bun run typecheck` pass.
