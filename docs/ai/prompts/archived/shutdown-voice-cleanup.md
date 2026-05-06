# Shutdown Voice Cleanup Prompt Draft

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready.

## Desired Outcome

Make bot shutdown reliably disconnect from any active Discord voice channel through runtime disposal.

## Context

The user observed that shutdown does not always disconnect Jettbot from voice even though disposal of the runtime should handle cleanup. Voice lifecycle is split across TypeScript runtimes/services and the Rust sidecar.

## Constraints

- Preserve IRA boundaries: lifecycle cleanup belongs in runtimes/runs, not Discord UI policy code.
- Do not add a fake cleanup path that only works for one command.
- Include sidecar cleanup behavior in the investigation.

## Acceptance Checks

- A shutdown path disposes active voice sessions and tells the sidecar to leave voice.
- Focused tests cover cleanup behavior without connecting to Discord.
- Existing voice join/leave commands still work.
- `bun run typecheck` and focused tests pass.
