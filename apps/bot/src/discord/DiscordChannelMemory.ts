import type { Message } from "discord.js";
import type { AppEnv } from "../app/AppRuntime";
import type { MemoryMessage } from "../memory/MemoryService";

export const channelBackfillBeforeLimit = 10;
export const channelGapFillLimit = 100;

export interface DiscordChannelCursor {
  readonly guildId: string;
  readonly channelId: string;
  readonly lastMessageId: string;
  readonly lastMessageCreatedAt: number;
  readonly initializedAtMs: number;
  readonly gapBackfillTruncated?: boolean;
}

type MessageLike = Pick<Message, "id" | "guildId" | "channelId" | "content" | "createdTimestamp" | "author"> & {
  readonly member?: { readonly displayName?: string | null } | null;
};

export const discordChannelCursorKey = (guildId: string, channelId: string): string => `discord.channel_cursor:${guildId}:${channelId}`;

const isCursor = (value: unknown): value is DiscordChannelCursor => {
  if (value == null || typeof value !== "object") return false;
  const cursor = value as Partial<DiscordChannelCursor>;
  return (
    typeof cursor.guildId === "string" &&
    typeof cursor.channelId === "string" &&
    typeof cursor.lastMessageId === "string" &&
    typeof cursor.lastMessageCreatedAt === "number" &&
    typeof cursor.initializedAtMs === "number"
  );
};

export const messageToMemoryMessage = (message: MessageLike): MemoryMessage | undefined => {
  const text = message.content.trim();
  if (!message.guildId || text.length === 0) return undefined;
  return {
    sourceId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    username: message.author.username,
    ...(message.member?.displayName ? { displayName: message.member.displayName } : {}),
    text,
    createdAt: message.createdTimestamp,
  };
};

const sortMessagesAscending = (messages: Iterable<Message>): readonly Message[] =>
  [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

const fetchChannelMessages = async (
  message: Message,
  options: { readonly before?: string; readonly after?: string; readonly limit: number },
): Promise<readonly Message[]> => {
  const manager = (message.channel as { readonly messages?: { readonly fetch?: (options: unknown) => Promise<unknown> } }).messages;
  if (typeof manager?.fetch !== "function") return [];
  const result = await manager.fetch(options);
  if (result instanceof Map) return sortMessagesAscending(result.values() as Iterable<Message>);
  if (result && typeof result === "object" && "values" in result && typeof result.values === "function") {
    return sortMessagesAscending(result.values() as Iterable<Message>);
  }
  return [];
};

const shouldCacheAuthor = (message: Message, botUserId: string | undefined): boolean => !message.author.bot || message.author.id === botUserId;

const saveCacheableMessages = async (runtime: { readonly env: AppEnv }, messages: readonly Message[]): Promise<void> => {
  const botUserId = runtime.env.discord.client.user?.id;
  for (const message of messages) {
    if (!shouldCacheAuthor(message, botUserId)) continue;
    const memory = messageToMemoryMessage(message);
    if (memory) await runtime.env.memory.saveMessage(memory);
  }
};

export const cacheDiscordMessageWithBoundedBackfill = async (runtime: { readonly env: AppEnv }, message: Message): Promise<void> => {
  const memory = messageToMemoryMessage(message);
  if (!memory?.guildId || !memory.channelId) return;
  const key = discordChannelCursorKey(memory.guildId, memory.channelId);
  const existing = await runtime.env.memory.getSelfState(key);
  const cursor = isCursor(existing) ? existing : undefined;

  let gapBackfillTruncated = cursor?.gapBackfillTruncated;
  if (!cursor) {
    const before = await fetchChannelMessages(message, { before: message.id, limit: channelBackfillBeforeLimit });
    await saveCacheableMessages(runtime, before);
  } else if (cursor.lastMessageId !== message.id) {
    const gap = await fetchChannelMessages(message, { after: cursor.lastMessageId, limit: channelGapFillLimit });
    gapBackfillTruncated = gap.length >= channelGapFillLimit;
    await saveCacheableMessages(runtime, gap.filter((item) => item.id !== message.id));
  }

  await runtime.env.memory.saveMessage(memory);
  await runtime.env.memory.setSelfState(
    key,
    "discord.channel_cursor",
    {
      guildId: memory.guildId,
      channelId: memory.channelId,
      lastMessageId: message.id,
      lastMessageCreatedAt: message.createdTimestamp,
      initializedAtMs: cursor?.initializedAtMs ?? Date.now(),
      ...(gapBackfillTruncated ? { gapBackfillTruncated } : {}),
    } satisfies DiscordChannelCursor,
    { guildId: memory.guildId },
  );
};

export const __discordChannelMemoryTestUtils = {
  isCursor,
  fetchChannelMessages,
};
