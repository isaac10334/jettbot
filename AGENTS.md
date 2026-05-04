# Jettbot

Jettbot is a multi-featured AI Discord bot with memory, realtime voice, parallel multi-user transcription and stitching, and more.

## Operating Rules

- Be direct and fail fast.
- Do not continue through broken setup, missing dependencies, unreachable dev server, or failing verification.
- Stop and summarize the blocker when human action is required.
- Prefer small, working vertical slices over broad speculative platform work.
- Do not implement fake features unless they are clearly disabled placeholders.

## Stack

- Bun
- Rust for the Discord audio stuff, used as a sidecar. The crates used are serenity and songbird.
- Discord.js, but deliberately avoiding @discordjs/voice because it is unreliable, and the Rust sidecar should handle that.

## IRA Architecture

Use IRA heavily.

- Services own committed domain truth.
- Runtimes own lifecycle, root Run, tasks, signals, installed modules, and cleanup.
- Bridges expose selected runtime/service surfaces to UI, HTTP, MCP, or external tools.
- Signals are occurrences.
- Stores are current state.
- Tasks/runs own async and cancelable work. See `@loop-kit/common` for `Task`, `Run`, `Runtime`, `Signal`, and more useful primitives for IRA.
- React components render state and dispatch commands only.
- Business logic must not live in UI components.

## Files To Read First

Before major changes, inspect:

- `ai/README.md`
- `docs/ai/ARCHITECTURE.md`
- `docs/ai/UI_GUIDE.md`
- `docs/ai/HANDOFF.md`
- package scripts in `package.json`
- existing persistence/schema files, if present
- existing domain/runtime/bridge folders

If these docs are missing, create lightweight versions instead of guessing.

## Handoff Policy

At the start of every session, read `docs/ai/HANDOFF.md` before changing code. This is the only canonical handoff file. Do not create or maintain any other `HANDOFF.md` file unless the user explicitly asks for it.

Use the handoff as external project memory, not as a verbose activity log. Keep it useful for the next agent with:

- current state and active focus
- known project truths
- active risks or blockers
- next prompt index
- recent verification summary

Do not maintain exhaustive "Files Touched" or "Commands Run" lists in the handoff. Git is the source of truth for file diffs, and shell history is not reliable shared memory. Summarize meaningful verification instead: what passed, what failed, and what was intentionally skipped.

If you create auxiliary memory, prompt drafts, or planning files, keep the set small and link every one from `docs/ai/HANDOFF.md`. Unlinked agent memory files are considered stale and should be removed or linked.
