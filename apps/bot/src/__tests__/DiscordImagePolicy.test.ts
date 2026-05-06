import { describe, expect, test } from "bun:test";
import { __discordImagePolicyTestUtils } from "../image/installDiscordImagePolicy";
import type { ImageSearchSession } from "../image/ImageSearchSessionService";

const createSession = (overrides: Partial<ImageSearchSession["results"][number]> = {}): ImageSearchSession => ({
  id: "session",
  ownerUserId: "user",
  query: "album cover",
  index: 0,
  createdAt: 0,
  expiresAt: 1_000,
  results: [{
    title: "Result",
    pageUrl: "https://page.test",
    imageUrl: "https://image.test/original.jpg",
    thumbnailUrl: "https://image.test/thumb.jpg",
    source: "image.test",
    ...overrides,
  }],
});

describe("Discord image policy", () => {
  test("prefers original image URLs when dimensions are suitable", () => {
    expect(__discordImagePolicyTestUtils.selectEmbedImageUrl(createSession({ width: 1200, height: 800 }).results[0]!)).toEqual({
      url: "https://image.test/original.jpg",
      source: "original",
    });
  });

  test("falls back to Brave thumbnail for tiny originals", () => {
    expect(__discordImagePolicyTestUtils.selectEmbedImageUrl(createSession({ width: 320, height: 200 }).results[0]!)).toEqual({
      url: "https://image.test/thumb.jpg",
      source: "thumbnail",
    });
  });

  test("uses Brave thumbnail when original dimensions are unknown", () => {
    expect(__discordImagePolicyTestUtils.selectEmbedImageUrl(createSession().results[0]!)).toEqual({
      url: "https://image.test/thumb.jpg",
      source: "thumbnail",
    });
  });

  test("records image quality selection metrics while rendering", () => {
    const counters: string[] = [];
    const timings: Array<[string, number]> = [];
    const rendered = __discordImagePolicyTestUtils.renderSession(createSession({
      width: 1200,
      height: 800,
      thumbnailWidth: 500,
      thumbnailHeight: 333,
    }), {
      increment: (name: string) => counters.push(name),
      recordTiming: (name: string, value: number) => timings.push([name, value]),
    } as any);

    expect(counters).toContain("image.render.original");
    expect(timings).toContainEqual(["image.render.original_width_px", 1200]);
    expect(rendered.embeds[0]?.toJSON().image?.url).toBe("https://image.test/original.jpg");
  });

  test("expired image buttons fail quietly", async () => {
    const calls: string[] = [];
    const interaction = {
      customId: "img:next:missing",
      user: { id: "user" },
      deferUpdate: async () => {
        calls.push("deferUpdate");
      },
      reply: async () => {
        calls.push("reply");
      },
    };
    const runtime = {
      env: {
        imageSearchSessions: {
          get: () => undefined,
        },
      },
    };

    await __discordImagePolicyTestUtils.handleButton(runtime as any, interaction as any);

    expect(calls).toEqual(["deferUpdate"]);
  });

  test(".img message and /img command use the same search defaults and render path", async () => {
    const searchRequests: unknown[] = [];
    const replies: unknown[] = [];
    const edits: unknown[] = [];
    const createRuntime = () => ({
      env: {
        env: { JETTBOT_IMAGE_SEARCH_COUNT: 20 },
        console: { info: () => undefined },
        imageRateLimits: { consume: () => ({ allowed: true }) },
        imageSearch: {
          search: async (input: unknown) => {
            searchRequests.push(input);
            return {
              query: "album cover",
              results: createSession().results,
            };
          },
        },
        imageSearchSessions: {
          create: ({ response }: any) => ({
            ...createSession(),
            query: response.query,
            results: response.results,
          }),
        },
        metrics: {
          increment: () => undefined,
          recordTiming: () => undefined,
        },
      },
    });

    await __discordImagePolicyTestUtils.handleMessage(createRuntime() as any, {
      content: ".img album cover",
      guildId: "guild",
      author: { bot: false, id: "user" },
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
    } as any);

    await __discordImagePolicyTestUtils.handleCommand(createRuntime() as any, {
      commandName: "img",
      guildId: "guild",
      user: { id: "user" },
      options: { getString: () => "album cover" },
      deferReply: async () => undefined,
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
    } as any);

    expect(searchRequests).toEqual([
      { query: "album cover", count: 20, safeSearch: "off" },
      { query: "album cover", count: 20, safeSearch: "off" },
    ]);
    expect((replies[0] as any).embeds[0].toJSON().image.url).toBe("https://image.test/thumb.jpg");
    expect((edits[0] as any).embeds[0].toJSON().image.url).toBe("https://image.test/thumb.jpg");
  });
});
