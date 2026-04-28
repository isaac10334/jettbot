# Jettbot UI Guide

Jettbot does not currently have a UI surface in this repo.

If a UI is added:

- Components render state and dispatch commands only.
- Business logic stays in services, policies, runtimes, or bridges.
- Use dense operational layouts for bot/runtime state, logs, metrics, and voice sessions.
- Avoid fake controls. Disabled placeholders must be clearly disabled.
