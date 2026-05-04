# Prompt Personality And Context Assembly Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Run fourth, after the memory/database foundation has a usable first slice.

## Desired Outcome

Centralize Jettbot's personality and prompt/context assembly so text and voice responses use one shared brain instead of scattered hardcoded strings. Make sure that Jettbot is funny and even edgy, roleplaying and even simulating emotions like anger.

## Context

Jettbot currently has personality and memory context embedded in narrow response paths. Future behavior needs one explicit assembly path that can combine personality, scoped preferences, retrieved memories, runtime awareness, and active warnings for both Discord text and voice.

## Implementation Direction

- Add or design a `PersonalityService` that owns the active personality profile and any scoped user/guild preferences that affect tone or behavior.
- Add an explicit prompt/context assembly service or domain boundary used by both text mentions and voice response generation.
- Assemble context packets from:
  - active personality/profile
  - scoped user/guild preferences
  - relevant retrieved episodes, semantic memories, and procedural memories
  - current awareness snapshot
  - active runtime warnings or recent failures
  - transcription hints relevant to the current users/channel/session
- Keep prompt assembly deterministic and testable. Policies should request assembled context rather than constructing prompts inline.
- Do not add Live/UseGPU as the first implementation. Live may be a future fit for reactive prompt assembly, but the immediate architecture should use IRA services, runtimes, policies, and explicit context packets.
- Preserve concise Discord voice behavior: responses should remain suitable for TTS unless the active context requests otherwise.

## Acceptance Checks

- Hardcoded personality/system prompt fragments are centralized or routed through a clear assembly interface.
- Text and voice paths can share the same prompt/personality/context assembly surface.
- Tests cover assembly precedence and inclusion/exclusion of memory, preferences, warnings, and awareness snapshots.
- No source path fetches Discord history directly just to assemble every prompt; it should use the memory/database and bounded fetch rules from the memory prompt.
- Typecheck and focused tests pass.
