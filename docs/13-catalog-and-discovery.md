# Catalog, matching and discovery

Owner: P4. Dependencies: P2 resolution, P3 eligible library/history, P1 browsing components.

## Launch provider spike

Select providers only after proving authorized access to search, metadata, artwork and permitted audio use. Check credentials, rate limits, quotas, geography and redistribution/cache limits. Keep a provider-capability matrix and a working permitted-content fallback. Neither spotDL nor Spotube guarantees that Spotify data, recommendations or audio will be accessible to a new application.

## Catalog plan

1. Normalize provider objects into app IDs, preserving provider references, source attribution and recording versions.
2. Implement track/album/artist lookup, discography, credits, artwork and cursor-paginated search.
3. Add search suggestions, category filters and ranking. Lyrics search requires a suitable provider; treat it as later if no authorized index exists.
4. Support genres/moods/activities, charts and new releases from actual available data. Handle missing/limited datasets explicitly.
5. Cache permitted metadata with TTL, backoff and freshness indicators; retain saved metadata when providers are unavailable.

## Recording matching

Build candidate queries from title, artists, album, duration, optional ISRC and version flags. Score evidence, not popularity alone. A cover/live/remix/clean mismatch must lower confidence or reject a candidate. Return matched, ambiguous or no-match with reasons. Maintain correction overrides per recording/provider. P2 resolves accepted candidates to ephemeral streams or download jobs.

Reference [spotDL provider structure](https://github.com/spotDL/spotify-downloader/tree/master/spotdl/providers) and [Spotube provider separation](02-upstream-references.md). Audit pinned matching implementation before reuse; do not assume downloaded output is the exact original recording.

## Discovery sequence

Launch: Home shelves based on saved/recent music, editorial or curated lists, basic related-track suggestions and basic radio. Respect explicit filtering and blocked artists.

Subsequent work:

- Smart Shuffle recommendations and Autoplay candidates consumed by P2.
- Daily mixes, artist/genre/decade/mood mixes, Discover Weekly and Release Radar equivalents.
- Daylist, On Repeat, Repeat Rewind and personalized playlist suggestions.
- Following/new-release feeds, upcoming-release hub and pre-save workflows.
- Taste Profile exclusions, hide/snooze feedback and classification for Smart Filters.
- AI playlist prompts and AI DJ commentary/requests. Use explainable selection and bounded generation; measure per-user cost before enabling a free service.
- Concert recommendations, venue following, local-show playlists, ticket and merchandise links.
- External conversational/discovery integrations after provider support is validated.

These reproduce product concepts with our own ranking, not Spotify's private recommendation model. New users get a deliberate cold-start experience rather than fabricated personalization.

## Acceptance

Use a labeled recording test set including remasters, live versions, covers and clean/explicit variants. Measure mismatch and no-match rates. Test paging, query cancellation, rate limiting, provider outage, cold-start recommendations, taste exclusion and artist blocking. Deliver a capability matrix identifying features unavailable with chosen sources.
