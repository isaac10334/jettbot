# Audio Debugging Reference

Read this before changing Discord voice, AssemblyAI, ElevenLabs, ffmpeg, or sidecar playback code.

## Known Good Voice Path

- Rust sidecar receives decoded Discord user audio from Songbird as `pcm_s16le`, 48 kHz, stereo.
- TypeScript normalizes each known user stream to `pcm_s16le`, 16 kHz, mono for AssemblyAI.
- AssemblyAI audio must be sent as 50-1000 ms binary chunks. Jettbot uses 100 ms / 3200 byte packets.
- Known final transcripts enter the stitcher and conversation engine. `unknown_ssrc:*` transcripts are diagnostic-only.
- ElevenLabs stream playback through the sidecar uses `pcm_24000`; the sidecar converts PCM s16le chunks to f32 samples for Songbird `RawAdapter`.

## Failure Modes To Avoid

- AssemblyAI close code `3007`: usually means audio packet duration is invalid. Do not send 20 ms / 640 byte packets directly.
- `unknown_ssrc:*` transcripts: useful for STT diagnostics, but never trigger memory, LLM, TTS, or tool calls.
- SSRC attribution race: `ClientConnect` and `SpeakingStateUpdate` may arrive before receive is enabled. Mapping events must be processed even while `VoiceTick` audio remains gated.
- Repeated Songbird `Decode error for SSRC ...: Other`: noisy UDP receive diagnostics. Keep them in `logs/sidecar.log`, but do not flood console output.
- WAV fixed-offset parsing: ffmpeg can insert `LIST/INFO` chunks before `data`. Parse RIFF chunks, do not assume canonical offsets.
- ElevenLabs `opus_48000_128`: the current sidecar stream path does not accept Opus input. Unsupported ElevenLabs stream formats must resolve to `pcm_24000` unless real Opus playback support is implemented and tested.
- Odd PCM chunk boundaries: streamed PCM can split a sample across chunks. Carry the dangling byte into the next chunk before s16le -> f32 conversion.
- TTS input-send completion is not playback completion. Wait for sidecar `PlaybackDebug stage=end` or `PlaybackFinished` before starting the next Jettbot speech stream in the same guild.

## Live Log Checks

- `bun run voice:analyze -- --skip-tool-versions` should select the latest session by `LastWriteTime`.
- A successful run should show known users, AssemblyAI `Turn`, LLM response logs, TTS logs, playback starts/finishes, and `Missing stages: (none)`.
- After the conversation-engine queue fix, `Playback overlap: overlappingStreams=0` is expected for Jettbot speech in a single guild.
- Keep only the latest 3 realtime session folders with `bun run voice:cleanup-logs`.

## Artifact Checks

- `audio/users/<userId>/discord-input.wav`: PCM s16le, 48 kHz, stereo.
- `audio/users/<userId>/assemblyai-input.wav`: PCM s16le, 16 kHz, mono.
- `audio/tts/*-elevenlabs-output.raw`: provider PCM bytes when using `pcm_24000`.
- `audio/tts/*-sidecar-input.raw`: bytes sent to sidecar playback.
- `audio/tts/*-sidecar-f32le.raw`: debug conversion from PCM s16le to f32le for inspection.
