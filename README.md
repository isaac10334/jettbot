# Jettbot

Jettbot is a Discord bot split into two processes:

- Bun + TypeScript owns Discord text/slash commands, AI orchestration, transcription, TTS, tools, memory, and Installed Runtime Architecture lifecycle.
- Rust owns Discord voice via Serenity/Songbird, voice receive, playback, and voice session state.

## Prerequisites

- Bun 1.3+
- Rust 1.89+
- A Discord bot token and application ID
- AssemblyAI API key
- ElevenLabs API key and voice ID
- Vercel AI Gateway key or OIDC environment
- Optional: Turso database URL/token
- Optional: `yt-dlp` and `ffmpeg`

Songbird depends on Opus. On Windows this may require a working C toolchain and CMake when the Opus crate builds native code.

## Setup

```sh
bun install
cp .env.example .env
bun run sidecar:build
bun run dev
```

The sidecar receives `DISCORD_BOT_TOKEN` through its environment at startup. IPC is JSON Lines over stdio; sidecar stdout is protocol only and stderr is logs only.

Put `/bin` on path on Windows. Otherwise, you'll have to set up yt-dlp yourself.

## Scripts

- `bun run dev` starts the Bun bot.
- `bun run typecheck` runs TypeScript checks.
- `bun test` runs Bun tests.
- `bun run sidecar:build` builds the Rust sidecar release binary.
- `bun run sidecar:dev` runs the Rust sidecar directly.
- `bun run check` runs TypeScript, Bun tests, and Rust tests.

## Current Limitations

- One voice session is supported at a time.
- Rust receive uses Songbird decoded `VoiceTick` events and emits per-user PCM S16LE chunks.
- Playback IPC and queueing are implemented; the first pass treats arbitrary TTS bytes as a sidecar playback stream boundary. Exact Discord-ready transcoding remains a focused follow-up if the provider output is not directly accepted by Songbird.
- Tool calling is registered behind a service interface; deep AI SDK tool execution is intentionally minimal in this pass.
- Turso memory starts with schema creation, recent search, and FTS-style text search. Vector search is reserved for a later embeddings pass.
