import { afterEach, describe, expect, test } from "bun:test";
import { createBraveImageSearchService } from "../image/BraveImageSearchService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createBraveImageSearchService", () => {
  test("explicitly disables Brave safe search by default", async () => {
    let requestedUrl: string | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return Response.json({ results: [] });
    }) as unknown as typeof fetch;

    const service = createBraveImageSearchService({ BRAVE_SEARCH_API_KEY: "key" } as any);
    await service.search({ query: "album cover", count: 3 });

    expect(requestedUrl).toBeDefined();
    expect(new URL(requestedUrl!).searchParams.get("safesearch")).toBe("off");
  });

  test("does not use Brave placeholder URLs as display thumbnails", async () => {
    globalThis.fetch = (async () => Response.json({
      results: [{
        title: "Result",
        url: "https://page.test/result",
        properties: {
          url: "https://image.test/original.jpg",
          placeholder: "https://imgs.search.brave.com/placeholder",
          width: 320,
          height: 200,
        },
      }],
    })) as unknown as typeof fetch;

    const service = createBraveImageSearchService({ BRAVE_SEARCH_API_KEY: "key" } as any);
    const response = await service.search({ query: "album cover" });

    expect(response.results[0]?.thumbnailUrl).toBeUndefined();
  });

  test("logs Brave response diagnostics for debugging result quality", async () => {
    const logs: Array<[string, unknown]> = [];
    globalThis.fetch = (async () => Response.json({
      query: {
        original: "album cover",
        altered: "album covers",
        show_strict_warning: false,
      },
      extra: {
        might_be_offensive: true,
      },
      results: [{
        type: "image_result",
        title: "Result",
        url: "https://page.test/result",
        source: "page.test",
        confidence: "high",
        thumbnail: {
          src: "https://imgs.search.brave.com/thumb",
          width: 500,
          height: 250,
        },
        properties: {
          url: "https://image.test/original.jpg",
          placeholder: "https://imgs.search.brave.com/placeholder",
          width: 1200,
          height: 600,
        },
      }],
    })) as unknown as typeof fetch;

    const service = createBraveImageSearchService({ BRAVE_SEARCH_API_KEY: "key" } as any, {
      console: {
        info: (name: string, value: unknown) => logs.push([name, value]),
      } as any,
    });
    await service.search({ query: "album cover", count: 3 });

    expect(logs[0]?.[0]).toBe("image.search.brave.response");
    expect((logs[0]?.[1] as any).request.safesearch).toBe("off");
    expect((logs[0]?.[1] as any).query.altered).toBe("album covers");
    expect((logs[0]?.[1] as any).extra.mightBeOffensive).toBe(true);
    expect((logs[0]?.[1] as any).results[0].thumbnailUrl).toBe("https://imgs.search.brave.com/thumb");
    expect((logs[0]?.[1] as any).results[0].placeholderUrl).toBe("https://imgs.search.brave.com/placeholder");
  });
});
