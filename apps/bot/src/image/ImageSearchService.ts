export type ImageSafeSearch = "strict" | "off";

// Brave Image Search defaults to strict if omitted. Jettbot is a private bot:
// keep this off and always send safesearch=off on image requests.
export const defaultImageSafeSearch: ImageSafeSearch = "off";

export interface ImageSearchRequest {
  readonly query: string;
  readonly count?: number;
  readonly country?: string;
  readonly searchLang?: string;
  readonly safeSearch?: ImageSafeSearch;
}

export interface ImageSearchResult {
  readonly title: string;
  readonly pageUrl: string;
  readonly imageUrl: string;
  readonly thumbnailUrl?: string;
  readonly source?: string;
  readonly width?: number;
  readonly height?: number;
  readonly thumbnailWidth?: number;
  readonly thumbnailHeight?: number;
}

export interface ImageSearchResponse {
  readonly query: string;
  readonly results: readonly ImageSearchResult[];
}

export interface ImageSearchService {
  readonly search: (request: ImageSearchRequest) => Promise<ImageSearchResponse>;
}
