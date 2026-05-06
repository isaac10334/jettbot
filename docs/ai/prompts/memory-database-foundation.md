# Memory Database Foundation Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

Active, partially implemented. This prompt is no longer blocked by YouTube playback.

## Current State

- Jettbot uses Turso/libSQL through `@libsql/client`, with Drizzle schema/migration files checked in.
- Runtime initialization still defensively creates/repairs tables so local file-backed libSQL and Turso both work.
- Implemented layers:
  - `raw_observations`
  - `episodes`
  - `semantic_memories`
  - `procedural_memories`
  - `self_state`
  - `personality_settings`
  - legacy-compatible `messages`, `transcript_turns`, and `tool_events`
- Text-channel memory now stores Discord message snowflakes, author labels, content, timestamps, and raw observation entries.
- For each channel, first sight fetches 10 messages before the triggering message; later gaps are filled up to 100 messages after the last cached snowflake. Do not crawl entire old channels.

## Next Work

- Live-verify Turso in a real bot session with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
- Add explicit message edit/delete observations and update the prompt context behavior for edited/deleted cached messages.
- Add focused admin/read commands for inspecting channel cursors and recent cached channel context.
- Start episode generation only after raw observations and channel context are proven in live use.
- Keep retrieval pragmatic: scoped SQL filters and TypeScript reranking before vectors or lexical search.

## Guardrails

- Do not collapse raw observations, episodes, semantic memory, procedural memory, and self-state into one vague table.
- Discord fetch is for bounded startup/prelude, gap repair, and explicit read commands. It is not the default response-time source of truth.
- Store timestamps as epoch milliseconds.
- Preserve local file fallback when Turso env vars are absent.

## Acceptance Checks

- Focused memory/channel-cache tests pass.
- `bun run typecheck` and `bun run check` pass.
- A live mention can answer using recent non-ping channel messages from the database.
