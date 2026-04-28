import { describe, expect, test } from "bun:test";
import { createTranscriptStitcherService } from "../transcription/TranscriptStitcherService";

describe("TranscriptStitcherService", () => {
  test("emits only final turns as conversation-ready", async () => {
    const stitcher = createTranscriptStitcherService();
    const ready = stitcher.conversationTurnReady.once();
    stitcher.acceptTurn({ userId: "u1", text: "hel", isFinal: false, receivedAt: 1 });
    stitcher.acceptTurn({ userId: "u1", text: "hello", isFinal: true, receivedAt: 2 });
    await expect(ready).resolves.toMatchObject({ text: "hello", userId: "u1" });
    expect(stitcher.turns).toHaveLength(2);
  });
});

