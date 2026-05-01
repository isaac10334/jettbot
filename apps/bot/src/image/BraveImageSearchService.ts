import type { Env } from "../Env";
import type { ImageSearchResponse, ImageSearchResult, ImageSearchService } from "./ImageSearchService";

const endpoint = "https://api.search.brave.com/res/v1/images/search";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

const asPositiveNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

const asUrl = (value: unknown): string | undefined => {
  const text = asString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const mapResult = (value: unknown): ImageSearchResult | undefined => {
  if (!isRecord(value)) return undefined;
  const properties = isRecord(value.properties) ? value.properties : {};
  const pageUrl = asUrl(value.url);
  const imageUrl = asUrl(properties.url);
  if (!pageUrl || !imageUrl) return undefined;

  const thumbnailUrl = asUrl(value.thumbnail?.src) ?? asUrl(value.thumbnail) ?? asUrl(properties.placeholder);
  const title = asString(value.title) ?? "Image result";
  const source = asString(value.source) ?? asString(value.domain);
  const width = asPositiveNumber(properties.width);
  const height = asPositiveNumber(properties.height);

  return {
    title,
    pageUrl,
    imageUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(source ? { source } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
};

export const createBraveImageSearchService = (env: Env): ImageSearchService => ({
  search: async (request): Promise<ImageSearchResponse> => {
    const query = request.query.trim();
    if (!query) throw new Error("Image search query is required.");

    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(Math.max(request.count ?? 20, 1), 200)));
    url.searchParams.set("safesearch", request.safeSearch ?? "strict");
    if (request.country) url.searchParams.set("country", request.country);
    if (request.searchLang) url.searchParams.set("search_lang", request.searchLang);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Brave image search failed: ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }

    const data = (await response.json()) as unknown;
    const root = isRecord(data) ? data : {};
    const results = Array.isArray(root.results) ? root.results.map(mapResult).filter((result): result is ImageSearchResult => result != null) : [];
    return { query, results };
  },
});
