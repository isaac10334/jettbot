# Voice Pipeline Debug Prompt

Status: completed as a "make voice work" prompt. Keep this as a regression checklist; use `voice-conversation-engine-latency.md` for the next active voice work.

Read `docs/ai/HANDOFF.md` first. This prompt is for the next intentional live Discord voice run after local checks pass.

## Goal

Prove the voice pipeline in stages, without counting diagnostic-only `unknown_ssrc:*` transcripts as end-to-end success:

Discord receive -> known-user AssemblyAI transcript -> LLM streamed response -> ElevenLabs stream -> Rust sidecar playback through Discord.

## Current Evidence

- Latest successful session: `logs/realtime/5-5-26_8-16-PM_624393515249434644_1150310214139138170_e5247532-b39f-4323-baf4-84b6fe986550`.
- The full pipeline worked in that run: known-user transcripts, LLM response, ElevenLabs `audio/pcm`, and Discord playback.
- The next regression gate is no overlapping Jettbot speech: `bun run voice:analyze -- --skip-tool-versions` should report `Playback overlap: overlappingStreams=0` on a fresh run.
- Previous 2:16 PM evidence:
- The previous attribution blocker is fixed in that run: transcripts were attributed to known Discord user `377268939035639810` through SSRC `18101`.
- AssemblyAI worked: 11 session events with `open`, `Begin`, `SpeechStarted`, and 4 `Turn` messages.
- LLM and ElevenLabs were reached. TTS failed at sidecar enqueue because the live env requested `ELEVENLABS_OUTPUT_FORMAT=opus_48000_128`; ElevenLabs returned `audio/opus`, and the sidecar streaming playback path rejected `opus_48000_128`.
- Current code resolves unsupported ElevenLabs stream formats to `pcm_24000` before the ElevenLabs request and before sidecar playback. `text/tts.jsonl` must show `requestedFormat`, effective `format`, and `formatOverridden`.
- Repeated Songbird UDP receive warnings such as `Decode error for SSRC ...: Other` are noisy receive-path diagnostics. They remain in `logs/sidecar.log` but should not flood the console.
- TTS debug saves ElevenLabs raw output, sidecar input, and `pcm_24000` debug f32 conversion artifacts.

## Required Preflight

1. Run `bun run voice:analyze` and confirm the latest session is selected.
2. Run `bun run voice:cleanup-logs` so only the latest 3 realtime sessions remain.
3. Run focused local checks before any live bot run:
   - `bun test apps/bot/src/__tests__/TranscriptionPipeline.test.ts apps/bot/src/__tests__/AudioNormalizationService.test.ts apps/bot/src/__tests__/VoiceService.test.ts apps/bot/src/__tests__/RealtimeDebugCaptureService.test.ts apps/bot/src/__tests__/VoiceSessionDiagnostics.test.ts apps/bot/src/__tests__/VoicePipelineOffline.test.ts`
   - `bun test apps/bot/src/__tests__/RustSidecarService.test.ts`
   - `bun run typecheck`
   - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sidecar.ps1 test`
   - `bun run sidecar:build`
   - `bun run voice:diagnose-audio`
4. Stop immediately if required env vars are missing, the sidecar build fails, `ffmpeg`/`ffprobe` are unavailable, or local verification fails.

## Live Stage Gates

- Stage 1: Join/receive.
  - `text/voice-events.jsonl` must show `receive_enabled`, `first_voice_tick`, and decoded audio evidence.
  - New sidecar diagnostics should show `sidecar_runtime`, `receive_enabled`, `decoded_voice_tick`, and preferably `client_connect_mapped`; `speaking_state_mapped` is also valid.
  - `client_connect_mapped` may be marked `early_buffered: true`; that is expected and means the race fix is working.
  - `unknown_ssrc_audio_fallback` without any mapping stage means attribution still failed.
- Stage 2: AssemblyAI.
  - `text/transcription-sessions.jsonl` must show `open`, `Begin`, `SpeechStarted`, and `Turn`.
  - `text/audio-events.jsonl` should show `assemblyai.audio_sent` with 100 ms / 3200 byte packets.
  - Captured WAVs must validate as Discord 48 kHz stereo and AssemblyAI 16 kHz mono.
- Stage 3: Known speaker.
  - Do not proceed to live LLM/TTS claims until at least one transcript has a real Discord user ID, not `unknown_ssrc:*`.
  - `text/stitched-transcripts.jsonl` must show accepted known-user turns with speaker label/user ID context.
  - If only unknown SSRC transcripts appear, inspect `client_connect_mapped`, `speaking_state_mapped`, `attribution_mapping_missing`, and `unknown_ssrc_audio_fallback` before touching LLM/TTS.
- Stage 4: LLM/TTS/playback.
  - `text/llm-messages.jsonl`, `text/llm-stream.jsonl`, `text/llm-partial-responses.jsonl`, and `text/llm-responses.jsonl` must appear.
  - `text/tts.jsonl` and `audio/tts/*elevenlabs-output*`, `*sidecar-input*`, and `*sidecar-f32le*` artifacts must appear for PCM output.
  - If `ELEVENLABS_OUTPUT_FORMAT` is set to an unsupported stream format such as `opus_48000_128`, `text/tts.jsonl` must show `requestedFormat: "opus_48000_128"`, `format: "pcm_24000"`, and `formatOverridden: true`.
  - The ElevenLabs response should be PCM for playback. If `contentType` is still `audio/opus`, stop and inspect `ElevenLabsTtsService` format resolution before changing the sidecar.
  - `text/voice-events.jsonl` must show playback begin/debug/end for TTS, with no unexplained sidecar playback errors.

## Acceptance

- AssemblyAI produces final turns for a known Discord user.
- Unknown SSRC transcripts remain logs-only and do not trigger memory, LLM, or TTS.
- A known-user final transcript produces an LLM response, ElevenLabs audio chunks, and audible Discord playback.
- `bun run check` passes after any changes made during the investigation.
