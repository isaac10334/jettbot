# YouTube Loading Latency And Streaming Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready after the WAV playback path and queue UI are working.

## Desired Outcome

Reduce `/youtube` time-to-audible-playback without regressing the reliable WAV/Songbird path.

## Context

YouTube playback currently works, but the file path appears to wait for the complete `yt-dlp` download and full FFmpeg WAV conversion before sending `PlayAudioFile` to the sidecar. That is unacceptable for long videos because a multi-hour queue item can leave Jettbot stuck in `preparing` for a long time.

## Implementation Direction

- Measure the current phases first: resolve, first media byte, download complete, FFmpeg start, first decoded audio byte, file ready, `PlayAudioFile`, Songbird `playable`, and audible playback start.
- Prefer a small vertical improvement that starts playback before the full source video is downloaded.
- Do not regress the known-good WAV/PCM decoder support, RIFF chunk parsing, or queue UI behavior.
- Investigate whether `yt-dlp -o -` to FFmpeg stdin works reliably on Windows/Bun now; fail fast if it still hangs.
- If direct piping is unreliable, consider a bounded rolling-buffer or partial-file strategy where Rust/Songbird receives a stable stream without high-frequency TypeScript IPC chunks.
- Add metrics and realtime debug events for startup latency and long-video behavior.

## Acceptance Checks

- A long video does not require full download before playback can begin.
- The UI exposes a clear `preparing` state until Songbird reports `playable`.
- Stop All and Skip still terminate active `yt-dlp`/FFmpeg work and sidecar playback.
- Focused YouTube service/playback tests cover startup phase metrics and cancellation.
- `bun run typecheck`, focused tests, and `bun run check` pass.
