# Provider capability matrix

Owner: P4. Evidence and caveats are in the [provider spike](16-provider-spike.md). Update this table whenever a source changes.

**Tested** means a live request succeeded on 2026-10-31. **Untested** means the feature may exist, but we have not proven it.

## Sources

| Source | Role | Key needed | Access basis | License or terms | Limits |
| --- | --- | --- | --- | --- | --- |
| MusicBrainz | Canonical metadata | No, but an identifying User-Agent is required | Documented API | Core data CC0. Tags and ratings CC BY-NC-SA. | 1 request per second per IP |
| Cover Art Archive | Artwork | No | Documented API | Images are not covered by CC0 | None stated. Slow, 2–5 s. |
| YouTube Music (ytmusicapi) | Search, candidates, radio | No | **Unofficial** | Against YouTube's terms | Unknown. Can break without notice. |
| yt-dlp on YouTube | Streaming, downloads | No | **Unofficial** | Against YouTube's terms | Unknown. Needs a JS runtime. |
| Internet Archive | Permitted fallback | No | Public site and API | Per-item license. Site terms not read. | Not tested |
| Audius | Permitted fallback | No | Public API | Terms not read | Docs list a free plan of 10 requests per second and 500k per month |
| Local files | Permitted fallback | No | User's own files | User's responsibility | None |
| LRCLIB | Lyrics | No | Public API | No data license published | About 90 requests per minute when identified |
| ListenBrainz | Browse data | No | Public API | Terms not read | Not tested |

## Features by source

| Feature | MusicBrainz + CAA | YouTube Music / yt-dlp | ListenBrainz | Internet Archive | Audius | LRCLIB |
| --- | --- | --- | --- | --- | --- | --- |
| Search people can use | No, poor ranking | **Tested** | – | Basic | **Tested** | – |
| Track, album and artist details | **Tested** | Basic | – | Basic | Basic | – |
| ISRC | Partial, 10 of 17 | No | – | No | Rare, 2 of 25 | – |
| Explicit flag | **No** | **Tested** | – | No | Field exists, untested | – |
| Discography | **Tested** | Untested | – | – | Untested | – |
| Artwork | **Tested** | Thumbnails, untested | – | Varies | Yes | – |
| Credits | Untested | No | – | – | Partial | – |
| Charts | No | **Failed** (parser error) | Sitewide tested | – | Trending tested | – |
| New releases | No | Untested | **Tested** | – | – | – |
| Genres and moods | Genre names | Moods tested | Untested | – | Tags | – |
| Related artists | No | Untested | Untested | – | – | – |
| Radio | No | **Tested**, 50 tracks | – | – | – | – |
| Popular tracks per artist | No | Untested | **Tested** | – | – | – |
| Streaming with seek | – | **Tested** on CC BY | – | **Tested** | **Tested** | – |
| Download | – | Untested | – | Direct files, untested | Some tracks, 4 of 25, untested | – |
| Synced lyrics | – | – | – | – | – | **Tested**, 18 of 20 |

## Launch features at risk

| Feature | Status | Plan |
| --- | --- | --- |
| Mainstream catalog | Depends entirely on the YouTube exception | If YouTube fails, only the fallback catalog remains. Show that honestly. |
| Charts | YouTube Music parser failed | Use ListenBrainz sitewide data and label it accordingly. |
| Related tracks and artists | Untested from an adopted source | Check in task 11 or 12, or fall back to YouTube Music radio. |
| Explicit filtering | Data is missing for many recordings | Filter fails closed. `unknown` is hidden when the setting is on. |
| Credits | Untested | Check in task 6. |
| Lyrics search | No authorized index | Later, as doc 13 allows. |

## Permitted-content fallback

If YouTube fails, the app keeps working in this order:

1. **Local files**, always available.
2. **Internet Archive items** under CC BY, BY-SA or CC0, each with a license on record. About 9% of a 500-item sample qualified. Credit is required.
3. **Audius tracks from verified uploaders** once its terms have been read. Never treat an unverified upload of a mainstream song as a match.

A fallback must never silently replace a requested recording with a different one. If the same recording is not available, the match result is `no-match`.

## Not available from any selected source

Spotify's editorial playlists, recommendation model, Canvas, Clips and music-video catalog, and licensed story content. Equivalent features remain planned against available data.
