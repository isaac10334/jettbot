import { describe, expect, test } from "bun:test";
import { createImageSearchSessionService } from "../image/ImageSearchSessionService";

const result = {
  title: "Result",
  pageUrl: "https://example.com/page",
  imageUrl: "https://example.com/image.jpg",
};

describe("ImageSearchSessionService", () => {
  test("moves within result bounds", () => {
    const sessions = createImageSearchSessionService({ defaultTtlMs: 60_000 });
    const session = sessions.create({
      ownerUserId: "u1",
      response: { query: "cats", results: [result, { ...result, title: "Result 2" }] },
    });

    expect(sessions.move(session.id, "prev")?.index).toBe(0);
    expect(sessions.move(session.id, "next")?.index).toBe(1);
    expect(sessions.move(session.id, "next")?.index).toBe(1);
  });

  test("expires sessions", () => {
    const sessions = createImageSearchSessionService({ defaultTtlMs: 10 });
    const session = sessions.create({
      ownerUserId: "u1",
      response: { query: "cats", results: [result] },
      ttlMs: 10,
    });

    expect(sessions.get(session.id, session.createdAt + 9)).toBeDefined();
    expect(sessions.get(session.id, session.createdAt + 10)).toBeUndefined();
  });
});
