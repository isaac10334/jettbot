# Prompt Personality And Context Assembly Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

Active, partially implemented.

## Current State

- Text mentions and voice predicted-turn generation now share `ConversationService`.
- Shared prompt context includes active personality, scoped memory, recent cached channel messages for text, stitched transcript context for voice, and `self_state`.
- `PersonalityService` owns selectable profiles.
- Current default profile is `unhinged_gremlin`; selectable profiles also include `dry_menace`, `edgy_roaster`, and `chaotic_character`.
- `/personality` and `/memory` are admin-only through `ADMIN_USER_ID`.

## Next Work

- Improve profile quality and add a clear admin workflow for editing or previewing profile prompts.
- Add precedence tests for guild/user profile overrides if scoped personalities are expanded.
- Add active runtime warnings and transcription hints to prompt context once AwarenessRuntime exists.
- Tighten voice prompt behavior so Jettbot speaks less often but with stronger character when he does speak.

## Guardrails

- Keep business logic out of Discord handlers. Policies should ask services for assembled context.
- Keep voice responses concise enough for TTS unless explicitly requested otherwise.
- Edgy personalities may roast and use profanity, but must not use slurs, protected-class harassment, threats, doxxing, or targeted real-world harm.

## Acceptance Checks

- Prompt assembly tests cover personality, memory, channel context, voice transcript context, and exclusions.
- Text and voice paths continue sharing the same assembly surface.
- `bun run typecheck` and focused tests pass.
