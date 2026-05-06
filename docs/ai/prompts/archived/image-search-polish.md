# Image Search Polish Prompt Draft

Read `docs/ai/HANDOFF.md` first.

## Readiness

Ready.

## Desired Outcome

Improve the private-bot image search experience after safe search defaulted to off.

## Context

`.img` and `/img` render Discord embeds with previous/next buttons. Results come from Brave Image Search and sessions are cached in memory for button pagination. The user noticed images look blurry and expired button clicks can post a pointless ephemeral expiration message after the visible image remains in chat.

## Constraints

- Keep the feature private-bot oriented; do not add public-server moderation policy unless requested.
- Keep image session state runtime-owned and in-memory unless there is a concrete need for persistence.
- Preserve the existing command surface.

## Acceptance Checks

- Embeds prefer higher-quality image URLs when Discord can render them reliably.
- Expired previous/next buttons fail quietly or produce a less confusing response.
- Session TTL behavior is documented or made more ergonomic.
- Focused tests cover result rendering/session expiration behavior where practical.
- `bun run typecheck` and focused tests pass.

## Pasted Brave Search Documentation

[Here is the pasted Brave Search API documentation.](../../references/brave_image_search_docs.md)
