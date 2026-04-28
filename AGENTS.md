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

- `docs/ai/ARCHITECTURE.md`
- `docs/ai/UI_GUIDE.md`
- `docs/ai/HANDOFF.md`
- package scripts in `package.json`
- existing Jazz schema files
- existing domain/runtime/bridge folders

If these docs are missing, create lightweight versions instead of guessing.

## Handoff Policy

When making meaningful changes, update `docs/ai/HANDOFF.md` with:

- what changed
- files touched
- commands run
- what passed
- what failed or was skipped
- next recommended task

This is your memory, so use it often, and remember that without it, you will forget everything about this repo. Do not write vague handoffs. Make them useful for the next Codex session. Review it at the start of each session, and update it throughout the session (or at the end). This is a requirement, except in rare cases where your task is extremely small. The structure of the handoff file is completely your choice - base it on whatever you think is most important to remember in the future. Remember, without it, you will not know a single thing!
