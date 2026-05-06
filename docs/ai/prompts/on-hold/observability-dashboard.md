# Observability Dashboard Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

On hold. Build this only after the voice/memory/personality loop is stronger and the dashboard has a clear operator workflow.

## Current State

- The repo already has logging, metrics snapshots, sidecar logs, realtime debug folders, and voice/session analyzers.
- These are enough for current debugging without a dashboard.

## Resume When

- Realtime voice or memory behavior needs repeated inspection that logs/scripts make too slow.
- There is a clear first screen and command surface for the dashboard.

## Guardrails

- Dashboard is a bridge over existing state/logs, not a domain owner.
- Keep privacy handling explicit; logs and realtime artifacts can contain Discord messages, transcripts, and audio.
- Start with a dense operational view, not a broad web-app platform.

## Acceptance Checks If Resumed

- Can inspect recent logs, metrics, voice sessions, and memory/cache state without changing bot behavior.
- Focused tests cover any API/bridge layer.
- `bun run typecheck` and relevant tests pass.
