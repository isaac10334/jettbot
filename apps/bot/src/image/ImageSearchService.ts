export type ImageSafeSearch = "strict" | "off";

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
}

export interface ImageSearchResponse {
  readonly query: string;
  readonly results: readonly ImageSearchResult[];
}

export interface ImageSearchService {
  readonly search: (request: ImageSearchRequest) => Promise<ImageSearchResponse>;
}
