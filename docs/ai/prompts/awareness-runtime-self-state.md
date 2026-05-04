# AwarenessRuntime Self-State Design Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Run fifth, after prompt/personality/context assembly has a stable context packet shape.

## Desired Outcome

Design an `AwarenessRuntime` or equivalent self-state/body-schema layer that tracks what Jettbot currently knows about its own runtime situation and makes that state available to prompts and policies.

## State To Track

- Current guild, channel, thread, and voice session context.
- Users currently speaking and active conversation participants.
- Recent mentions and recently addressed users.
- Active jobs, tool calls, playback streams, transcription sessions, and other cancelable tasks.
- Recent tool, provider, runtime, Discord, and sidecar failures.
- Whether Jettbot is currently speaking or queued to speak.
- Active personality/profile.
- Current transcription hints such as names, games, slang, project terms, and user-specific pronunciation/context clues.

## Implementation Direction

- Treat self-state as current runtime state, not as the durable memory log. Persist significant state changes separately as raw observations only when they matter for history.
- Keep lifecycle and cleanup in runtimes/runs. Services may expose committed truth; policies react to awareness changes and issue typed commands.
- Expose a compact awareness snapshot for prompt/context assembly.
- Expose policy-friendly stores/signals for events such as user started speaking, bot started speaking, tool failed, voice session changed, or transcription hints changed.
- Include confidence/provenance where awareness comes from unreliable signals such as Discord presence or inferred user activity.
- Allow Jettbot to ask clarifying questions rather than blindly guessing from spoofable or stale signals.

## Acceptance Checks

- The design identifies the owning runtime/service boundaries and the snapshot shape consumed by prompt assembly.
- Policies can react to awareness changes without scraping logs or Discord handlers.
- Tests cover state updates, cleanup on session end, and snapshot generation.
- Awareness state improves promptability without turning transient runtime facts into permanent semantic memory by default.
- Typecheck and focused tests pass if implementation happens in this pass.
