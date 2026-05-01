import type { ToolDefinition } from "../tools/ToolRegistry";
import type { ImageSearchResponse, ImageSearchService } from "./ImageSearchService";

export const createImageSearchTool = (imageSearch: ImageSearchService): ToolDefinition<{ readonly query: string; readonly count?: number }, ImageSearchResponse> => ({
  name: "image_search",
  description: "Search the web for images using Brave Image Search.",
  call: async (input) => imageSearch.search({ query: input.query, count: input.count ?? 10, safeSearch: "strict" }),
});
