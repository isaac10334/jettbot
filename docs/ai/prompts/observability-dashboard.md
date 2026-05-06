# Observability Dashboard Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Draft. Build this after the existing logs, metrics, and realtime debug files expose enough structured data to make a dashboard useful.

## Desired Outcome

Add an IRA-aligned web dashboard for inspecting Jettbot runtime health, logs, metrics, measurements, voice sessions, YouTube playback phases, and image-search quality signals.

## Context

The repo already has `LoggingService`, `MetricsService`, realtime debug capture, sidecar logs, and JSONL artifacts. A dashboard should be a bridge over those surfaces, not a place for domain behavior.

## Implementation Direction

- Keep services as the source of committed domain truth; the dashboard only reads state/logs and dispatches explicit commands.
- Start with a dense operational view: recent logs, counters, timing summaries, active voice state, YouTube queue/loading phases, sidecar status, and image-search render metrics.
- Add simple charts for timing summaries and counts only after the data shape is stable.
- Prefer lightweight local development first; do not add a broad platform stack until the dashboard has a working vertical slice.
- Include privacy-aware handling because logs and realtime debug files can contain Discord content.

## Acceptance Checks

- The dashboard can inspect current logs and metrics without changing bot behavior.
- It shows enough YouTube loading and voice-session data to debug slow starts and stuck cleanup.
- It has focused tests for any API/bridge layer added.
- `bun run typecheck` and relevant tests pass.
