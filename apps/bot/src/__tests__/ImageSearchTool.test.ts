import { describe, expect, test } from "bun:test";
import { createImageSearchTool } from "../image/imageSearchTool";
import type { ImageSearchRequest, ImageSearchService } from "../image/ImageSearchService";

describe("createImageSearchTool", () => {
  test("uses the private-bot safe search default", async () => {
    let request: ImageSearchRequest | undefined;
    const imageSearch: ImageSearchService = {
      search: async (input) => {
        request = input;
        return { query: input.query, results: [] };
      },
    };

    const tool = createImageSearchTool(imageSearch);
    await tool.call({ query: "album cover", count: 3 });

    expect(request).toEqual({ query: "album cover", count: 3, safeSearch: "off" });
  });
});
