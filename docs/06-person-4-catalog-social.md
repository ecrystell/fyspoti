# Person 4: catalog, discovery, social and statistics ownership plan

## Outcome

Users can find identifiable recordings, discover music and eventually share listening. This role owns feature implementation, not team integration.

## Owned work

- Catalog adapters, canonical IDs, metadata normalization, search ranking and recording matching.
- Browse data, charts, new releases, discographies, credits and related artists.
- Basic Home recommendations, radio, playlist suggestions, Autoplay and Smart Shuffle selection.
- Later personalized mixes, daylist, repeat mixes, release feeds, AI DJ/playlists and taste feedback.
- Lyrics/media/story data integrations with P1, and concert/venue/merchandise feeds.
- Share-link resolution and public playlist discovery for launch.
- Later following, collaborative-playlist coordination, Blend, Jam, Messages and activity sharing.
- History aggregation, weekly statistics, Wrapped and milestones.

## Sequence

1. Validate one metadata source and one compatible audio-candidate source with P2.
2. Supply search/track/album/artist fixtures and real paginated endpoints.
3. Implement correct recording matching and unavailable/ambiguous outcomes.
4. Build basic browse/recommendations and launch share links.
5. Add richer discovery, then social and statistics independently; see 13 and 14.

## Boundaries

P2 resolves playable URLs and downloads. P3 owns private library and auth primitives. P4 owns social migrations and endpoints, including their access checks. P1 supplies design components; P4 implements feature panels as necessary. Do not route all development through P3 or P1.

## Acceptance

- Search results stay consistent under pagination and normalization.
- Live/remix/clean/explicit variants are not silently interchanged.
- Rate limits show recoverable states rather than empty libraries.
- Share links cannot expose private playlists.
- Recommendations respect explicit filtering, excluded history and blocked artists.

## Codex task example

Implement recording candidate scoring against a labeled fixture set, including remasters, covers and live versions. Return evidence with each score and a no-match outcome. Do not resolve streams or download files.

References: [Catalog](13-catalog-and-discovery.md), [social/statistics](14-social-and-statistics.md), [upstream map](02-upstream-references.md).
