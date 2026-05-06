import { createSignal } from "@loop-kit/common/Signal";
import { describe, expect, test } from "bun:test";
import { installRealtimeDebugBridge } from "../observability/installRealtimeDebugBridge";

describe("installRealtimeDebugBridge", () => {
  test("writes VoiceDebug events to voice-events", () => {
    const sidecarEvent = createSignal<any>();
    const writes: Array<{ path: string; value: unknown }> = [];

    installRealtimeDebugBridge({
      env: {
        signals: { sidecarEvent },
        env: { JETTBOT_RUST_SIDECAR_PATH: "sidecar.exe" },
        realtimeDebug: {
          startVoiceSession: () => undefined,
          endVoiceSession: async () => undefined,
          writeJsonLine: (path: string, value: unknown) => writes.push({ path, value }),
          dispose: async () => undefined,
          currentSessionPath: () => "logs/realtime/session",
        },
        console: { info: () => undefined, warn: () => undefined },
      },
    } as any);

    sidecarEvent.emit({ type: "VoiceDebug", stage: "receive_enabled", message: "enabled" });

    expect(writes).toEqual([
      { path: "text/voice-events.jsonl", value: { type: "VoiceDebug", stage: "receive_enabled", message: "enabled" } },
    ]);
  });

  test("buffers early VoiceDebug events until JoinedVoice starts the session", () => {
    const sidecarEvent = createSignal<any>();
    const writes: Array<{ path: string; value: any }> = [];
    let sessionPath: string | undefined;

    installRealtimeDebugBridge({
      env: {
        signals: { sidecarEvent },
        env: { JETTBOT_RUST_SIDECAR_PATH: "target/release/jettbot-voice-sidecar.exe" },
        realtimeDebug: {
          startVoiceSession: () => {
            sessionPath = "logs/realtime/session";
          },
          endVoiceSession: async () => undefined,
          writeJsonLine: (path: string, value: unknown) => writes.push({ path, value }),
          dispose: async () => undefined,
          currentSessionPath: () => sessionPath,
        },
        console: { info: () => undefined, warn: () => undefined },
      },
    } as any);

    sidecarEvent.emit({
      type: "VoiceDebug",
      stage: "client_connect_mapped",
      message: "ssrc=42",
      session_id: "session",
      user_id: "123",
      ssrc: 42,
    });
    expect(writes).toEqual([]);

    sidecarEvent.emit({
      type: "JoinedVoice",
      guild_id: "guild",
      channel_id: "channel",
      session_id: "session",
    });

    expect(writes).toContainEqual({
      path: "text/voice-events.jsonl",
      value: expect.objectContaining({
        type: "VoiceDebug",
        stage: "client_connect_mapped",
        early_buffered: true,
        ssrc: 42,
      }),
    });
    expect(writes).toContainEqual({
      path: "text/voice-events.jsonl",
      value: expect.objectContaining({
        type: "VoiceDebug",
        stage: "sidecar_runtime",
      }),
    });
  });
});
