import { describe, expect, test } from "bun:test";
import {
  cacheDiscordMessageWithBoundedBackfill,
  channelBackfillBeforeLimit,
  channelGapFillLimit,
  discordChannelCursorKey,
  messageToMemoryMessage,
} from "../discord/DiscordChannelMemory";

const createMessage = (input: {
  readonly id: string;
  readonly content: string;
  readonly createdTimestamp: number;
  readonly userId?: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly bot?: boolean;
  readonly before?: readonly any[];
  readonly after?: readonly any[];
}) => {
  const message: any = {
    id: input.id,
    guildId: "guild",
    channelId: "channel",
    content: input.content,
    createdTimestamp: input.createdTimestamp,
    author: {
      id: input.userId ?? "user",
      username: input.username ?? "isaac",
      bot: input.bot ?? false,
    },
    member: input.displayName ? { displayName: input.displayName } : undefined,
  };
  message.channel = {
    messages: {
      fetch: async (options: any) => {
        if (options.before) return new Map((input.before ?? []).map((item) => [item.id, item]));
        if (options.after) return new Map((input.after ?? []).map((item) => [item.id, item]));
        return new Map();
      },
    },
  };
  return message;
};

const createRuntime = () => {
  const saved: any[] = [];
  const state = new Map<string, unknown>();
  return {
    saved,
    state,
    runtime: {
      env: {
        discord: { client: { user: { id: "jettbot" } } },
        memory: {
          saveMessage: async (message: any) => saved.push(message),
          getSelfState: async (key: string) => state.get(key),
          setSelfState: async (key: string, _kind: string, value: unknown) => state.set(key, value),
        },
      },
    } as any,
  };
};

describe("Discord channel memory cache", () => {
  test("maps Discord messages with author labels", () => {
    expect(messageToMemoryMessage(createMessage({ id: "1", content: "hello", createdTimestamp: 10, displayName: "Isaac" }))).toEqual({
      sourceId: "1",
      guildId: "guild",
      channelId: "channel",
      userId: "user",
      username: "isaac",
      displayName: "Isaac",
      text: "hello",
      createdAt: 10,
    });
  });

  test("backfills ten previous messages the first time a channel is seen", async () => {
    const { runtime, saved, state } = createRuntime();
    const before = Array.from({ length: 12 }, (_, index) => createMessage({ id: `before-${index}`, content: `before ${index}`, createdTimestamp: index }));
    const current = createMessage({ id: "current", content: "Jettbot ping", createdTimestamp: 20, before: before.slice(0, channelBackfillBeforeLimit) });

    await cacheDiscordMessageWithBoundedBackfill(runtime, current);

    expect(saved.map((item) => item.sourceId)).toEqual([...before.slice(0, channelBackfillBeforeLimit).map((item) => item.id), "current"]);
    expect(state.get(discordChannelCursorKey("guild", "channel"))).toMatchObject({ lastMessageId: "current" });
  });

  test("fills a capped gap for known channels", async () => {
    const { runtime, saved, state } = createRuntime();
    state.set(discordChannelCursorKey("guild", "channel"), {
      guildId: "guild",
      channelId: "channel",
      lastMessageId: "old",
      lastMessageCreatedAt: 1,
      initializedAtMs: 1,
    });
    const gap = Array.from({ length: channelGapFillLimit }, (_, index) => createMessage({ id: `gap-${index}`, content: `gap ${index}`, createdTimestamp: index + 2 }));
    const current = createMessage({ id: "current", content: "Jettbot ping", createdTimestamp: 200, after: [...gap, createMessage({ id: "current", content: "Jettbot ping", createdTimestamp: 200 })] });

    await cacheDiscordMessageWithBoundedBackfill(runtime, current);

    expect(saved.at(-1)?.sourceId).toBe("current");
    expect(saved.some((item) => item.sourceId === "gap-0")).toBe(true);
    expect(state.get(discordChannelCursorKey("guild", "channel"))).toMatchObject({ lastMessageId: "current", gapBackfillTruncated: true });
  });
});
