# Memory Database Foundation Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Run third, after YouTube playback and voice observability/testing.

## Desired Outcome

Design and implement the first serious database foundation for Jettbot's shared brain without overbuilding a generic RAG platform.

## Architecture Direction

Use layered memory:

- Raw observation log: immutable-ish event facts for Discord messages, edits, deletes, voice events, tool calls, bot responses, errors, and runtime/provider events.
- Episodes: summaries of bounded events or sessions with time range, scope, participants, tags, source observation IDs, confidence, and importance.
- Semantic memories: facts, preferences, relationships, and project knowledge that are true now but may decay, expire, be superseded, or become "used to be true"; every item needs confidence/provenance.
- Procedural memories: rules, skills, and policies such as "when Isaac asks for CS2 commands, provide one copy-paste block first."
- Self-state/body schema: current runtime awareness such as connected guilds, current voice channel, speaking users, active jobs, recent failures, personality profile, and transcription hints. This is current state, not the durable event log.

## Database And Search Recommendation

- Prefer Turso Cloud with `@libsql/client`.
- Recommend Drizzle ORM plus `drizzle-kit` migrations for the first implementation because schema definitions, generated migrations, and Drizzle Studio/Turso UI inspection are more valuable here than Kysely's query-builder purity.
- Kysely remains reasonable for hand-written SQL-heavy projects, but do not choose it first unless Drizzle/libSQL compatibility is blocked.
- Store timestamps as Unix epoch milliseconds with names such as `created_at_ms`.
- Start with normal SQLite/Turso indexes and symbolic filters: guild, channel, user, scope, kind, confidence, importance, time, tags, tool, and status.
- Add vector similarity later over episodes and memory items after the durable schema and retrieval interfaces settle.
- Add lexical search later only if useful.
- Rerank in TypeScript before adopting larger search systems.
- Do not recommend Vespa or Meilisearch as the first serious implementation.

## Discord Context Rules

- Observe Discord message events while the bot is running and persist them as raw observations.
- Use Discord fetch for last 20 to 100 messages when invoked, startup/reconnect backfill, repairing missed gaps, and explicit read-this-channel/thread commands.
- Do not fetch Discord history every time as the main design. The database log should become the source of truth.

## Acceptance Checks

- The implemented foundation has explicit service-owned writes and migration-owned schema changes.
- Raw observations, episodes, semantic memories, procedural memories, and self-state are not collapsed into one vague `memories` table.
- Retrieval supports pragmatic symbolic filters first and leaves vector/lexical search as incremental upgrades.
- Tests cover schema initialization/migrations and service read/write behavior using local libSQL or in-memory SQLite where practical.
- Typecheck and focused tests pass.
