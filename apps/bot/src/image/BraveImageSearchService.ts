import type { Env } from '../Env';
import type { Console } from "@loop-kit/common/Console";
import type {
    ImageSearchResponse,
    ImageSearchResult,
    ImageSearchService,
} from './ImageSearchService';
import { defaultImageSafeSearch } from './ImageSearchService';

const endpoint = 'https://api.search.brave.com/res/v1/images/search';
const maxLoggedResults = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value : undefined;

const asPositiveNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;

const asUrl = (value: unknown): string | undefined => {
    const text = asString(value);
    if (!text) return undefined;
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:'
            ? url.toString()
            : undefined;
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

    const thumbnail = isRecord(value.thumbnail) ? value.thumbnail : {};
    const thumbnailUrl =
        asUrl(thumbnail.src) ??
        asUrl(value.thumbnail);
    const title = asString(value.title) ?? 'Image result';
    const source = asString(value.source) ?? asString(value.domain);
    const width = asPositiveNumber(properties.width);
    const height = asPositiveNumber(properties.height);
    const thumbnailWidth = asPositiveNumber(thumbnail.width);
    const thumbnailHeight = asPositiveNumber(thumbnail.height);

    return {
        title,
        pageUrl,
        imageUrl,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(source ? { source } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(thumbnailWidth ? { thumbnailWidth } : {}),
        ...(thumbnailHeight ? { thumbnailHeight } : {}),
    };
};

const summarizeResult = (value: unknown, index: number): Record<string, unknown> => {
    const result = isRecord(value) ? value : {};
    const properties = isRecord(result.properties) ? result.properties : {};
    const thumbnail = isRecord(result.thumbnail) ? result.thumbnail : {};
    const metaUrl = isRecord(result.meta_url) ? result.meta_url : {};
    return {
        index,
        type: asString(result.type),
        title: asString(result.title),
        source: asString(result.source) ?? asString(result.domain),
        pageUrl: asString(result.url),
        imageUrl: asString(properties.url),
        placeholderUrl: asString(properties.placeholder),
        width: asPositiveNumber(properties.width),
        height: asPositiveNumber(properties.height),
        thumbnailUrl: asString(thumbnail.src) ?? asString(result.thumbnail),
        thumbnailWidth: asPositiveNumber(thumbnail.width),
        thumbnailHeight: asPositiveNumber(thumbnail.height),
        confidence: asString(result.confidence),
        pageFetched: asString(result.page_fetched),
        metaUrl: {
            scheme: asString(metaUrl.scheme),
            netloc: asString(metaUrl.netloc),
            hostname: asString(metaUrl.hostname),
            path: asString(metaUrl.path),
        },
    };
};

const logResponseDiagnostic = (console: Console | undefined, input: {
    readonly requestUrl: URL;
    readonly raw: Record<string, unknown>;
    readonly rawResults: readonly unknown[];
    readonly mappedResults: readonly ImageSearchResult[];
}) => {
    const query = isRecord(input.raw.query) ? input.raw.query : {};
    const extra = isRecord(input.raw.extra) ? input.raw.extra : {};
    console?.info("image.search.brave.response", {
        request: {
            q: input.requestUrl.searchParams.get("q"),
            count: input.requestUrl.searchParams.get("count"),
            safesearch: input.requestUrl.searchParams.get("safesearch"),
            country: input.requestUrl.searchParams.get("country"),
            searchLang: input.requestUrl.searchParams.get("search_lang"),
        },
        query: {
            original: asString(query.original),
            altered: asString(query.altered),
            spellcheckOff: typeof query.spellcheck_off === "boolean" ? query.spellcheck_off : undefined,
            showStrictWarning: typeof query.show_strict_warning === "boolean" ? query.show_strict_warning : undefined,
        },
        extra: {
            mightBeOffensive: typeof extra.might_be_offensive === "boolean" ? extra.might_be_offensive : undefined,
        },
        rawResultCount: input.rawResults.length,
        mappedResultCount: input.mappedResults.length,
        droppedResultCount: input.rawResults.length - input.mappedResults.length,
        results: input.rawResults.slice(0, maxLoggedResults).map(summarizeResult),
    });
};

export const createBraveImageSearchService = (
    env: Env,
    options: { readonly console?: Console } = {},
): ImageSearchService => ({
    search: async (request): Promise<ImageSearchResponse> => {
        const query = request.query.trim();
        if (!query) throw new Error('Image search query is required.');

        const url = new URL(endpoint);
        url.searchParams.set('q', query);
        url.searchParams.set(
            'count',
            String(Math.min(Math.max(request.count ?? 20, 1), 200)),
        );
        url.searchParams.set('safesearch', request.safeSearch ?? defaultImageSafeSearch);
        if (request.country) url.searchParams.set('country', request.country);
        if (request.searchLang)
            url.searchParams.set('search_lang', request.searchLang);

        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY,
            },
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
                `Brave image search failed: ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`,
            );
        }

        const data = (await response.json()) as unknown;
        const root = isRecord(data) ? data : {};
        const rawResults = Array.isArray(root.results) ? root.results : [];
        const results = Array.isArray(root.results)
            ? root.results
                  .map(mapResult)
                  .filter(
                      (result): result is ImageSearchResult => result != null,
                  )
            : [];
        logResponseDiagnostic(options.console, { requestUrl: url, raw: root, rawResults, mappedResults: results });
        return { query, results };
    },
});
