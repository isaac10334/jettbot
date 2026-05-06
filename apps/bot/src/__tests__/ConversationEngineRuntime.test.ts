import { describe, expect, test } from "bun:test";
import { createConversationEngineRuntime } from "../conversation/ConversationEngineRuntime";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

const turn = (input: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  guildId: "guild",
  channelId: "channel",
  sessionId: "session",
  userId: "user",
  username: "user",
  displayName: "User",
  text: "hello jettbot",
  isFinal: true,
  receivedAt: 1_000,
  ...input,
});

describe("ConversationEngineRuntime", () => {
  test("emits speak when Jettbot is directly addressed", () => {
    const engine = createConversationEngineRuntime();
    const decisions: any[] = [];
    engine.decisions.subscribe((decision) => decisions.push(decision));

    const decision = engine.ingestTranscriptTurn(turn());

    expect(decision.kind).toBe("speak");
    expect(decision.turn?.displayName).toBe("User");
    expect(decisions).toHaveLength(1);
  });

  test("keeps unknown SSRC transcript decisions diagnostic-only", () => {
    const engine = createConversationEngineRuntime();

    const decision = engine.ingestTranscriptTurn(turn({ userId: "unknown_ssrc:123", text: "hello jettbot" }));

    expect(decision.kind).toBe("ignore");
    expect(decision.reason).toContain("unknown SSRC");
  });

  test("queues speech when Jettbot is already speaking", () => {
    const engine = createConversationEngineRuntime();
    engine.markSpeechStarted("guild", "speech-1");

    const decision = engine.ingestTranscriptTurn(turn());

    expect(decision.kind).toBe("queueSpeech");
    expect(engine.state.get().guilds.guild?.botSpeechStatus).toBe("speaking");
  });

  test("interrupts self only for stop commands while speech is active", () => {
    const engine = createConversationEngineRuntime();
    engine.markSpeechStarted("guild", "speech-1");

    const decision = engine.ingestTranscriptTurn(turn({ text: "jettbot stop talking" }));

    expect(decision.kind).toBe("interruptSelf");
    expect(decision.priority).toBe("high");
  });

  test("waits when multiple known speakers talk in a short window without direct address", () => {
    const engine = createConversationEngineRuntime();

    engine.ingestTranscriptTurn(turn({ userId: "user-a", text: "one thing", receivedAt: 1_000 }));
    const decision = engine.ingestTranscriptTurn(turn({ userId: "user-b", text: "another thing", receivedAt: 1_500 }));

    expect(decision.kind).toBe("wait");
  });
});
