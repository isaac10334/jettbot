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
        realtimeDebug: {
          startVoiceSession: () => undefined,
          endVoiceSession: async () => undefined,
          writeJsonLine: (path: string, value: unknown) => writes.push({ path, value }),
          dispose: async () => undefined,
          currentSessionPath: () => undefined,
        },
        console: { info: () => undefined },
      },
    } as any);

    sidecarEvent.emit({ type: "VoiceDebug", stage: "receive_enabled", message: "enabled" });

    expect(writes).toEqual([
      { path: "text/voice-events.jsonl", value: { type: "VoiceDebug", stage: "receive_enabled", message: "enabled" } },
    ]);
  });
});
