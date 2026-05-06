# YouTube Loading Latency And Streaming Prompt

Read `docs/ai/HANDOFF.md` first.

## Status

On hold. YouTube playback is currently working well enough through the reliable WAV/Songbird path.

## Current State

- Plain search uses `ytsearch1:`.
- Direct URLs resolve normally.
- `yt-dlp` downloads `bestaudio`.
- FFmpeg prepares `audio.wav` as `pcm_s16le`, 48 kHz, stereo.
- Rust sidecar plays via Songbird `File` input with Symphonia `pcm`/`wav` support.
- Queue UI, skip, and stop-all behavior exist.

## Resume When

- Long-video time-to-audible playback becomes a real user-visible problem again.
- YouTube preparation blocks higher-priority conversation or voice work.

## Guardrails

- Do not regress the known-good WAV path, RIFF chunk parsing, queue UI, or sidecar file playback.
- Avoid returning to high-frequency TypeScript IPC PCM streaming unless a measured design proves it is reliable on Windows.

## Acceptance Checks If Resumed

- Startup phase metrics exist.
- Long videos can become audible before full download, or the UX clearly communicates preparation.
- Skip/Stop All terminates active `yt-dlp`, FFmpeg, and sidecar playback.
- Focused YouTube tests, `bun run typecheck`, and `bun run check` pass.
