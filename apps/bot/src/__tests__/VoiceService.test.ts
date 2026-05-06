import { createSignal } from "@loop-kit/common/Signal";
import { describe, expect, test } from "bun:test";
import type { SidecarCommand, SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { RustSidecarService } from "../sidecar/RustSidecarService";
import { createVoiceService } from "../voice/VoiceService";
import { installVoiceSessionPolicy } from "../voice/installVoiceSessionPolicy";

const chunks = async function* (...values: Uint8Array[]) {
  for (const value of values) yield value;
};

const createFakeSidecar = (options: { readonly failType?: string } = {}) => {
  const calls: SidecarCommand[] = [];
  const events = createSignal<SidecarEvent>();
  const sidecar: RustSidecarService = {
    events,
    start: async () => undefined,
    sendCommand: async (command) => {
      calls.push(command);
    },
    call: async (command) => {
      calls.push(command);
      if (command.type === options.failType) throw new Error(`${command.type} failed`);
      if (command.type === "PlayAudioFile") {
        setTimeout(() => events.emit({
          type: "PlaybackDebug",
          stream_id: command.stream_id,
          stage: "playable",
          message: "track_state=Play",
        }), 0);
      }
      if (command.type === "PlayAudioStreamEnd") {
        setTimeout(() => events.emit({
          type: "PlaybackFinished",
          guild_id: "guild",
          stream_id: command.stream_id,
        }), 0);
      }
    },
    stop: async () => undefined,
  };
  return { sidecar, calls, events };
};

describe("VoiceService", () => {
  test("join requests stay connecting until a JoinedVoice event updates state", async () => {
    const { sidecar, calls } = createFakeSidecar();
    const voice = createVoiceService(sidecar);
    const sidecarEvent = createSignal<SidecarEvent>();
    installVoiceSessionPolicy({ env: { sidecar, voice, signals: { sidecarEvent } } } as any);

    await voice.requestJoinVoice("guild", "channel");
    expect(calls).toEqual([{ type: "JoinVoice", guild_id: "guild", channel_id: "channel" }]);
    expect(voice.getGuildState("guild")).toEqual({ status: "connecting", guildId: "guild", channelId: "channel" });

    sidecarEvent.emit({ type: "JoinedVoice", guild_id: "guild", channel_id: "channel", session_id: "session" });
    expect(voice.getGuildState("guild")).toEqual({ status: "connected", guildId: "guild", channelId: "channel", sessionId: "session" });
    expect(calls.at(-1)).toEqual({ type: "StartReceive", guild_id: "guild" });
  });

  test("tracks voice sessions independently per guild", async () => {
    const { sidecar, calls } = createFakeSidecar();
    const voice = createVoiceService(sidecar);
    const sidecarEvent = createSignal<SidecarEvent>();
    installVoiceSessionPolicy({ env: { sidecar, voice, signals: { sidecarEvent } } } as any);

    await voice.requestJoinVoice("guild-a", "channel-a");
    await voice.requestJoinVoice("guild-b", "channel-b");
    sidecarEvent.emit({ type: "JoinedVoice", guild_id: "guild-a", channel_id: "channel-a", session_id: "session-a" });
    sidecarEvent.emit({ type: "JoinedVoice", guild_id: "guild-b", channel_id: "channel-b", session_id: "session-b" });

    expect(voice.getGuildState("guild-a")).toEqual({ status: "connected", guildId: "guild-a", channelId: "channel-a", sessionId: "session-a" });
    expect(voice.getGuildState("guild-b")).toEqual({ status: "connected", guildId: "guild-b", channelId: "channel-b", sessionId: "session-b" });
    expect(calls).toContainEqual({ type: "StartReceive", guild_id: "guild-a" });
    expect(calls).toContainEqual({ type: "StartReceive", guild_id: "guild-b" });
  });

  test("leaves all known active voice sessions during cleanup", async () => {
    const { sidecar, calls } = createFakeSidecar();
    const voice = createVoiceService(sidecar);
    voice.setGuildState("guild-a", { status: "connected", guildId: "guild-a", channelId: "channel-a", sessionId: "session-a" });
    voice.setGuildState("guild-b", { status: "connecting", guildId: "guild-b", channelId: "channel-b" });
    voice.setGuildState("guild-c", { status: "disconnected", guildId: "guild-c" });

    await voice.requestLeaveAllVoice();

    expect(calls).toContainEqual({ type: "StopPlayback", guild_id: "guild-a" });
    expect(calls).toContainEqual({ type: "LeaveVoice", guild_id: "guild-a" });
    expect(calls).toContainEqual({ type: "StopPlayback", guild_id: "guild-b" });
    expect(calls).toContainEqual({ type: "LeaveVoice", guild_id: "guild-b" });
    expect(calls).not.toContainEqual({ type: "LeaveVoice", guild_id: "guild-c" });
    expect(voice.getGuildState("guild-a")).toEqual({ status: "disconnected", guildId: "guild-a" });
    expect(voice.getGuildState("guild-b")).toEqual({ status: "disconnected", guildId: "guild-b" });
  });

  test("records the failed sidecar boundary when join fails", async () => {
    const { sidecar } = createFakeSidecar({ failType: "JoinVoice" });
    const voice = createVoiceService(sidecar);

    await expect(voice.requestJoinVoice("guild", "channel")).rejects.toThrow("JoinVoice failed");
    expect(voice.getGuildState("guild")).toEqual({ status: "error", guildId: "guild", message: "JoinVoice failed: JoinVoice failed" });
  });

  test("streams TTS as begin chunk end commands", async () => {
    const { sidecar, calls } = createFakeSidecar();
    const voice = createVoiceService(sidecar);

    await voice.enqueueTtsPlayback({
      guildId: "guild",
      streamId: "tts-1",
      format: "pcm_24000",
      chunks: chunks(new Uint8Array([1, 2]), new Uint8Array([3, 4])),
    });

    expect(calls).toEqual([
      { type: "PlayAudioStreamBegin", guild_id: "guild", stream_id: "tts-1", format: "pcm_24000" },
      { type: "PlayAudioStreamChunk", stream_id: "tts-1", bytes_base64: "AQI=" },
      { type: "PlayAudioStreamChunk", stream_id: "tts-1", bytes_base64: "AwQ=" },
      { type: "PlayAudioStreamEnd", stream_id: "tts-1" },
    ]);
  });

  test("plays files and stops playback through typed sidecar commands", async () => {
    const { sidecar, calls } = createFakeSidecar();
    const voice = createVoiceService(sidecar);

    await voice.playAudioFile({ guildId: "guild", streamId: "yt-1", format: "wav_pcm_s16le_48000_stereo", path: "audio.wav" });
    await voice.stopPlayback("guild");

    expect(calls).toEqual([
      { type: "PlayAudioFile", guild_id: "guild", stream_id: "yt-1", format: "wav_pcm_s16le_48000_stereo", path: "audio.wav" },
      { type: "StopPlayback", guild_id: "guild" },
    ]);
  });

  test("fails file playback when Songbird reports a track error", async () => {
    const calls: SidecarCommand[] = [];
    const events = createSignal<SidecarEvent>();
    const sidecar: RustSidecarService = {
      events,
      start: async () => undefined,
      sendCommand: async (command) => {
        calls.push(command);
      },
      call: async (command) => {
        calls.push(command);
        if (command.type === "PlayAudioFile") {
          setTimeout(() => events.emit({
            type: "PlaybackDebug",
            stream_id: command.stream_id,
            stage: "error",
            message: "track_state=Errored(Parse)",
          }), 0);
        }
      },
      stop: async () => undefined,
    };
    const voice = createVoiceService(sidecar);

    await expect(voice.playAudioFile({
      guildId: "guild",
      streamId: "yt-err",
      format: "wav_pcm_s16le_48000_stereo",
      path: "audio.wav",
    })).rejects.toThrow("Playback error");
  });
});
