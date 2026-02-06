# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands
- Install deps: `pnpm install`
- Dev (loopback): `pnpm dev` (runs `tsx src/loopback.ts`)
- Run main bot locally with tsx: `pnpm exec tsx src/index.ts`

## Environment/config notes (from code/README)
- Bot expects `DISCORD_TOKEN`, `GUILD_ID`, `VOICE_CHANNEL_ID`, `OPENAI_API_KEY` (see `src/index.ts` and `src/loopback.ts`).
- Optional flags: `MODEL`, `VOICE`, `DEBUG`, `FFMPEG_PATH`.

## High-level architecture

### Two bot paths (actor-based vs. legacy loopback)
- **Actor-based pipeline** (newer, modular): lives in `src/actors/**` and `src/__internal/ActorRuntime.ts`.
  - `ActorRuntime` defines `Mailbox` + async `Port` primitives and a service directory (provide/lookup/watch).
  - `VoiceIngressActor` (`src/actors/VoiceIngressActor.ts`) is the root for per-user tracks; it spawns `UserTrackActor` for each speaking user.
  - `UserTrackActor` (`src/actors/UserTrackActor.ts`) decodes Opus → 16k mono frames and exposes them via a `Port<Pcm16kMonoFrame>`. It watches for the `mixer` service.
  - `ModeSupervisorActor` (`src/actors/ModeSupervisorActor.ts`) chooses between loopback and agent pipelines and mounts the active subtree.
  - **Loopback pipeline** (`src/actors/loopback/*`): `LoopbackMixerActor` merges per-user frames into mixed 48k stereo PCM and streams it to `EgressActor`.
  - **Agent pipeline** (`src/actors/agent/*`): `SttActor` converts frames to transcripts, `TranscriptHubActor` merges finals, `BrainActor` streams LLM text chunks, `TtsActor` converts text → PCM and feeds `EgressActor`.
  - `EgressActor` (`src/actors/EgressActor.ts`) encodes PCM to Opus and sends it to Discord.

- **Legacy loopback/mixer** (class-based, not ActorRuntime): `src/bot/VoiceSessionActor.ts` orchestrates a mixer with per-user `UserTrackActor` (`src/bot/UserTrackActor.ts`), jitter buffering, and a PCM→Opus encoder path. This is used by `src/loopback.ts`.

### Audio plumbing
- `src/audio/io.ts` is the core bridge for PCM24k mono → FFmpeg upsample → Opus 48k stereo and provides the Discord playback runtime.
- `src/audio/*` contains frame chunking, jitter buffer, mono/stereo transforms, and mixing helpers used by the loopback path.
- `src/discord/voiceRuntime.ts` wraps Discord voice connection/player and exposes a `playOpusStream` helper.

### Entry points
- `src/index.ts` is the main bot that joins voice, wires Discord receiver → OpenAI Realtime sessions, and handles text commands (`!join`, `!leave`, `!beep`, `!yell`).
- `src/loopback.ts` is a simpler loopback runner that joins a channel and feeds the `VoiceSessionActor` mixer.
