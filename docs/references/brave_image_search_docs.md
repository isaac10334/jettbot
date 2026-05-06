# Image Search

Search from a comprehensive index of images across the web with advanced filtering options

## Overview

Image Search provides access to a vast index of images from across the internet.
Our service continuously crawls and indexes images from various sources, enabling
you to retrieve relevant visual content for your applications with powerful
filtering and customization options.

## Key Features

Search across billions of indexed images from diverse sources worldwide

Retrieve up to 200 images per request for comprehensive coverage

Target images from specific countries and in preferred languages

Default strict filtering ensures family-friendly results

## API Reference

View the complete API reference, including endpoints, parameters, and example
  requests

## Use Cases

Image Search is perfect for:

- **Visual Content Discovery**: Build image galleries and discovery features
- **E-commerce Applications**: Find product images and visual inspiration
- **Creative Tools**: Source images for design and creative projects
- **Content Management**: Discover and aggregate visual content
- **Research and Analysis**: Gather visual data for analysis and research

## Basic Search

Get started with a simple image search request:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=mountain+landscape" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

## Country and Language Targeting

Customize your image search results by specifying:

- **Country**: Prefer images from specific countries using country codes (or `ALL` for worldwide)
- **Search Language**: Prefer results by content language

Example request for images from Japan in Japanese:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=桜&country=JP&search_lang=ja" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

## Result Count Control

Image Search supports retrieving large batches of results:

- **Default**: 50 images per request
- **Maximum**: 200 images per request
- Higher limits than other search types for comprehensive visual content discovery

Example request for 100 images:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=wildlife+photography&count=100" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

The actual number of images returned may be less than requested based on
  available results for the query.

## Safe Search

Image Search prioritizes safe content with strict filtering by default:

- **strict**: Drops all adult content from search results (default)
- **off**: No filtering applied (except for illegal content)

This default setting ensures that image results are appropriate for all audiences out of the box.

Example request with safe search disabled:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=art&safesearch=off" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

Disabling safe search may return adult or inappropriate content. Use with
  caution and only when appropriate for your use case.

## Spellcheck

Image Search includes automatic spellcheck functionality to improve search accuracy:

- Enabled by default
- Automatically corrects common misspellings
- The modified query is used for search and available in the response
- Particularly useful for visual searches where terminology matters

To disable spellcheck:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=architecure&spellcheck=false" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

## Example: Complete Search Request

Here's a comprehensive example combining multiple parameters:

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=modern+architecture&country=US&search_lang=en&count=150&safesearch=strict" \
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

This request:

- Searches for "modern architecture"
- Targets US content
- Returns English language results
- Retrieves up to 150 images
- Applies strict safe search filtering

## Response Format

Each image result typically includes:

- Image URL and thumbnail
- Source page URL
- Image dimensions
- Title and description
- Publisher information

See the [API Reference](/api-reference/images/image_search) for complete response schema details.

## Image Proxy and Thumbnails

Each image result includes a thumbnail URL that is served through the Brave Search image proxy. The thumbnail is resized to have a width of **500 pixels** while maintaining the original aspect ratio.

### Why Brave Uses Proxied Image URLs

Brave Search uses proxied image URLs for two important reasons:

1. **Reduced load on source servers**: By caching and serving images through our proxy, we reduce the number of requests to the original image hosts.
2. **User privacy protection**: Proxied URLs prevent image source servers from tracking end users, as all requests originate from Brave's infrastructure rather than user devices.

### Properties Field

The `properties` field in each image result contains additional URL information:

- **url**: The original image URL from the source website
- **placeholder**: A small placeholder URL, also served through the Brave Search image proxy
- Properties often include `width` and `height` values, though these are not always available

This allows you to choose between the standard 500px thumbnail in the main response or access the original source URL when needed.

## Best Practices

### Query Optimization

- Use descriptive, specific terms for better results
- Combine multiple keywords to narrow down results
- Consider language and regional variations in terminology

### Performance

- Request only the number of images you need
- Use appropriate country and language filters to reduce noise
- Implement caching on your end to minimize API calls

### Content Safety

- Keep strict safe search enabled for public-facing applications
- Implement additional content moderation if needed for your specific use case
- Be aware of copyright and licensing when using discovered images

## Changelog

This changelog outlines all significant changes to the Brave Image Search API in chronological order.

- **2023-05-10** Add Brave Image Search API resource.
- **2024-01-20** Increase maximum result count to 200 images.
- **2024-08-15** Improve spellcheck accuracy for visual search terms.

# Image search API reference

`GET` `/v1/images/search`

Find images from a large independent index of images.

**Base URL:** `https://api.search.brave.com/res`

## Authorization

| Name | Location | Type | Required | Description |
|------|----------|------|----------|-------------|
| `x-subscription-token` | header | string | Yes | The subscription token that was generated for the product. |

## Query Parameters

| Name | Location | Type | Required | Description |
|------|----------|------|----------|-------------|
| `q` | query | string | Yes | The user's search query term. Query can not be empty. Maximum of 400 characters and 50 words in the query. |
| `search_lang` | query | string | No | The search language preference. The 2 or more character language code for which the search results are provided. |
| `country` | query | string | No | The search query country, where the results come from. The country string is limited to 2 character country codes of supported countries and `ALL` for worldwide. |
| `safesearch` | query | string | No | Filters search results for adult content. The following values are supported:  - **off** - No content filtering (except for illegal content). - **strict** - Drops all adult content from search results.   |
| `count` | query | integer | No | The number of search results returned in response. The maximum is 200. The actual number delivered may be less than requested. |
| `spellcheck` | query | boolean | No | Whether to spell check provided query. If the spell checker is enabled, the modified query is always used for search. The modified query can be found in altered key from the query response model. |

## Headers

| Name | Location | Type | Required | Description |
|------|----------|------|----------|-------------|
| `api-version` | header | string | No | The API version to use.                 This is denoted by the format `YYYY-MM-DD`.                 Default is the latest that is available. Read                 more about [API versioning](/documentation/guides/versioning). |
| `accept` | header | string | No | The default supported media type is application/json. |
| `cache-control` | header | string | No | Brave Search will return cached content by default.                 To prevent caching set the Cache-Control header to `no-cache`.                 This is currently done as best effort. |
| `user-agent` | header | string | No | The user agent originating the request.                 Brave search can utilize the user agent to provide a different                 experience depending on the device as described by the string.                 The user agent should follow the commonly used browser agent                 strings on each platform. For more information on curating user agents,                 see [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-user-agent). |

## Responses

### 200

Successful Response

| Field | Type | Description |
|-------|------|-------------|
| `type` | string? |  |
| `query` | object | Image search query string. |
| `query.original` | string | The original query that was requested. |
| `query.altered` | string? | The altered query by the spellchecker. This is the query that is used to search. |
| `query.spellcheck_off` | bool? | Whether the spellchecker is enabled or disabled. |
| `query.show_strict_warning` | bool? | The value is `true` if the lack of results is due to a `strict` safesearch setting. Adult content relevant to the query was found, but was blocked by safesearch. |
| `results` | object[] | The list of image results for the given query. |
| `results[].type` | string? | The type of image search API result. The value is always `image_result`. |
| `results[].title` | string? | The title of the image. |
| `results[].url` | string? | The original page URL where the image was found. |
| `results[].source` | string? | The source domain where the image was found. |
| `results[].page_fetched` | string? | The ISO date time when the page was last fetched. The format is `YYYY-MM-DDTHH:MM:SSZ`. |
| `results[].thumbnail` | object? | The thumbnail for the image. |
| `results[].thumbnail.src` | string? | The served URL of the image. |
| `results[].thumbnail.width` | int? | The width of the image. |
| `results[].thumbnail.height` | int? | The height of the image. |
| `results[].properties` | object? | Metadata for the image. |
| `results[].properties.url` | string? | The image URL. |
| `results[].properties.placeholder` | string? | The lower resolution placeholder image URL. |
| `results[].properties.width` | int? | The width of the image. |
| `results[].properties.height` | int? | The height of the image. |
| `results[].meta_url` | object? | Aggregated information on the URL associated with the image search result. |
| `results[].meta_url.scheme` | string? | The protocol scheme extracted from the URL. |
| `results[].meta_url.netloc` | string? | The network location part extracted from the URL. |
| `results[].meta_url.hostname` | string? | The lowercased domain name extracted from the URL. |
| `results[].meta_url.favicon` | string? | The favicon used for the URL. |
| `results[].meta_url.path` | string? | The hierarchical path of the URL useful as a display string. |
| `results[].confidence` | string? | The confidence level for the image result. |
| `extra` | object | Additional information about the image search results. |
| `extra.might_be_offensive` | bool? | Indicates whether the image search results might contain offensive content. |

### 404

Not Found

| Field | Type | Description |
|-------|------|-------------|
| `type` | string? |  |
| `error` | object |  |
| `error.id` | string | A unique identifier for this particular occurrence of the problem. |
| `error.status` | int | The HTTP status code applicable to this problem, expressed as a string value. |
| `error.detail` | string? | Explanation specific to this occurrence of the problem. Like title, this field's value can be localized. |
| `error.meta` | object? | A meta object containing non-standard meta-information about the error. |
| `error.code` | string | An application-specific error code, expressed as a string value. |
| `time` | int? |  |

### 422

Unprocessable Entity

| Field | Type | Description |
|-------|------|-------------|
| `type` | string? |  |
| `error` | object |  |
| `error.id` | string | A unique identifier for this particular occurrence of the problem. |
| `error.status` | int | The HTTP status code applicable to this problem, expressed as a string value. |
| `error.detail` | string? | Explanation specific to this occurrence of the problem. Like title, this field's value can be localized. |
| `error.meta` | object? | A meta object containing non-standard meta-information about the error. |
| `error.code` | string | An application-specific error code, expressed as a string value. |
| `time` | int? |  |

### 429

Too Many Requests

| Field | Type | Description |
|-------|------|-------------|
| `type` | string? |  |
| `error` | object |  |
| `error.id` | string | A unique identifier for this particular occurrence of the problem. |
| `error.status` | int | The HTTP status code applicable to this problem, expressed as a string value. |
| `error.detail` | string? | Explanation specific to this occurrence of the problem. Like title, this field's value can be localized. |
| `error.meta` | object? | A meta object containing non-standard meta-information about the error. |
| `error.code` | string | An application-specific error code, expressed as a string value. |
| `time` | int? |  |

## Code Samples

### cURL

```bash
curl "https://api.search.brave.com/res/v1/images/search?q=mountain+landscape" \
  -H "Accept: application/json" \ 
  -H "Accept-Encoding: gzip" \ 
  -H "X-Subscription-Token: <YOUR_API_KEY>"
```

### Python

```python
import requests

url = "https://api.search.brave.com/res/v1/images/search"

params = {
    "q": "mountain landscape"
}

headers = {
    "Accept": "application/json",
    "Accept-Encoding": "gzip",
    "X-Subscription-Token": "<YOUR_API_KEY>"
}

response = requests.get(url, params=params, headers=headers)
print(response.json())
```
