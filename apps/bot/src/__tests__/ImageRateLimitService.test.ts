import { describe, expect, test } from "bun:test";
import { createImageRateLimitService } from "../image/ImageRateLimitService";

describe("ImageRateLimitService", () => {
  test("limits requests inside a window and resets after it", () => {
    const limits = createImageRateLimitService({ limit: 2, windowMs: 1_000 });

    expect(limits.consume("u1", 0).allowed).toBe(true);
    expect(limits.consume("u1", 100).allowed).toBe(true);
    const blocked = limits.consume("u1", 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
    expect(limits.consume("u1", 1_000).allowed).toBe(true);
  });
});
