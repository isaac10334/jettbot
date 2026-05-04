# YouTube Playback Components Queue UI Prompt

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready after the YouTube WAV playback fix. The playback foundation works through `yt-dlp` search/URL resolve, FFmpeg WAV preparation, sidecar `PlayAudioFile`, and Songbird WAV/PCM decode.

## Desired Outcome

Build a polished Discord playback UI for `/youtube` with queue controls:

- show what is currently playing
- show queue length and a short queue preview
- stop the current track
- skip to the next queued track
- cancel the entire YouTube playback session and clear the queue
- enqueue additional `/youtube` requests when something is already playing

The first implementation may use Discord embeds plus button components, matching the existing image-search component pattern. A later pass can migrate the rendering to Discord Components V2 if the bot’s `discord.js` version and message flags support it cleanly.

## Critical Playback Facts

Do not regress the working audio path:

- Plain search queries use `ytsearch1:<query>`; direct URLs are passed through.
- YouTube audio is downloaded with `yt-dlp -f bestaudio --no-playlist`.
- FFmpeg prepares `audio.wav` with canonical playable audio: `pcm_s16le`, `48000Hz`, stereo.
- The sidecar command format is `wav_pcm_s16le_48000_stereo`.
- The Rust sidecar validates RIFF chunks, not fixed byte offsets. FFmpeg may insert `LIST/INFO` chunks before `data`.
- `crates/voice-sidecar/Cargo.toml` must keep Symphonia WAV/PCM decoder support enabled for Songbird playback.
- `VoiceService.playAudioFile` waits for `PlaybackDebug stage=playable` and fails fast on `error` or `end`.

Expected live success evidence:

- `text/youtube.jsonl` contains `youtube.file.ytdlp.start`, `youtube.file.ytdlp.exit`, `youtube.file.download.ready`, `youtube.file.ffmpeg.start`, `youtube.file.ffmpeg.exit`, and `youtube.file.ready`.
- `text/voice-events.jsonl` contains `PlaybackDebug input_created` with `wav file input created`, then `PlaybackDebug playable`.
- Console logs show `sidecar.playback.debug` for playable/error/end.

## Implementation Direction

- Keep queue/business behavior in a YouTube playback service, not Discord handlers.
- Discord handlers should render state and dispatch service commands only.
- `/youtube query:<text-or-url>` should:
  - join the requester’s voice channel if needed
  - resolve the query or URL
  - enqueue the result if something is already active
  - create or update one public playback message in the command channel
- The playback message should contain:
  - current title linked to the YouTube page
  - current status: preparing, playing, stopping, failed, or idle
  - duration when known
  - queue length
  - up-next preview for the first few queued items
  - concise last error if playback failed
- Buttons:
  - `Skip`: stop current track and start the next queued item
  - `Stop All`: stop current playback, terminate active YouTube/FFmpeg work, and clear the queue
  - disabled states should reflect idle/empty queue/current state
- `/stop` should call the same cancel-all path used by the Stop All button.
- Button handlers should be safe when the UI message is stale, the queue is empty, or playback has already ended.

## Acceptance Checks

- `/youtube weezer sweater song` resolves via search and plays.
- `/youtube <youtube-url>` resolves and plays.
- A second `/youtube` during playback queues instead of interrupting.
- The UI updates when:
  - a track is queued
  - a track starts preparing
  - Songbird reports playable
  - a track ends
  - Skip is pressed
  - Stop All is pressed
  - playback fails
- Queue length and preview are correct after enqueue, skip, natural end, and cancel-all.
- Focused tests cover queue service behavior and button custom-id handling.
- `bun run typecheck`, focused tests, `bun test`, Rust sidecar tests, `bun run sidecar:build`, and `bun run check` pass.

## Notes

- Avoid fake success. Do not edit the UI to “playing” until Songbird reports `playable`.
- Do not remove the WAV/PCM decoder features or revert to raw f32 file playback.
- Keep realtime debug files local and ignored; they may contain private Discord activity.
