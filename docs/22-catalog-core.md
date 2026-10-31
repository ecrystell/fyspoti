# Catalog core

Owner: P4. Code is in [packages/catalog](../packages/catalog/src) and [services/catalog-worker](../services/catalog-worker). This covers tasks 4–7: app-owned IDs, real search and lookups, and recording matching.

**Contract changes here need review from an affected owner** (see [Requests](#requests-to-other-owners)).

## Status

| Part | Status |
| --- | --- |
| `search`, `getTrack`, `getAlbum`, `getArtist` | Built. Tested with invented rows, and once against live YouTube Music. |
| `findCandidates`, with evidence and corrections | Built. Measured below. |
| `getRecommendations` | Not built (task 12). Returns an error so a surface cannot show "no music". |
| MusicBrainz identity, ISRC, credits, Cover Art Archive | Not built. Everything comes from YouTube Music so far. |
| Discography | Not built. `Artist` has no field for it, so this needs a contract change. |
| Connected to the app | **Not yet.** P1's renderer still reads the iTunes Search API. |
| Survives a restart | **No.** The store is in memory until task 9. |

## How to use it

Run this in Electron main or Node, because it starts a Python process. The renderer reaches it through a preload bridge, which does not exist yet.

```ts
import { createCatalog } from '@fyspoti/catalog';
import { createYtMusicWorker } from '@fyspoti/catalog/youtube-worker';

const worker = createYtMusicWorker({ python, workerPath });
const catalog = createCatalog({ ytMusic: worker });

const page = await catalog.search('some song', null);
const match = await catalog.findCandidates(trackId);
worker.close();
```

Install the worker's dependencies with `pip install -r services/catalog-worker/requirements.txt`. A packaged app needs to ship that Python, which is the same job as P2's worker.

Every catalog method resolves to a `Result`, so check `ok`. P3's `Library` throws `LibraryError` instead. Both are deliberate, and code that calls both has to handle both.

For a track from a playlist or an import, pass its snapshot:

```ts
await catalog.findCandidates(item.trackId, { hint: item.metadataSnapshot });
```

The catalog only knows tracks it has seen on this install. Without the hint, a synced or imported track returns `UNAVAILABLE`.

## Identity

| Thing | ID |
| --- | --- |
| Track | UUIDv5 of normalized primary artist, base title, 10-second duration bucket, version flags, and whether it is explicit |
| Album, artist | UUIDv5 of the provider and its ID |
| Candidate | UUIDv5 of track, provider and source |

Tracks use recording facts, not a YouTube ID, for three reasons: no provider defines identity, every install derives the same ID without a server, and a reissue of one recording shares an ID.

Known limits:

- **Changing the key changes every saved track's identity.** Any new rule needs a new namespace and a migration plan.
- **Two songs with one title, one artist and a similar length share an ID.** The duration bucket makes this rare.
- **A reissue that lands across a bucket boundary gets a second ID.** That leaves a duplicate, which is safer than the wrong song.
- **Spotify imports keep their provisional IDs.** `findCandidates` returns them unchanged, so an imported row can play without being rewritten. Swapping them for canonical IDs is still open with P3.

## Search

Songs, albums and artists are fetched in parallel in about 1.6 s. Pages hold up to 14 songs, 4 albums and 2 artists, so an album search is not buried under songs. A failed album or artist shelf still returns songs. A failed song shelf returns an error.

The provider has no paging, so one answer is held for 5 minutes and paged here. That also keeps pages stable while someone scrolls.

## Matching

A track from search already names its source, so it needs no matching. This section is about tracks known only by text: imports and items synced from another install.

Each row gets a confidence from title, artist, duration, official-audio type and album:

| Case | Effect |
| --- | --- |
| Different title or artist, or over 30 s out | Rejected |
| Live, remix, cover, karaoke, acoustic, instrumental, demo, clean or re-recording, on one side only | Rejected |
| Remaster or radio edit on one side only | Lower confidence, because it is the same performance |
| Live on both sides, with a different performance named | Lower confidence |
| Stated explicit status differs | Lower confidence |
| Official video with no duration to compare | No credit, because videos often have longer cuts |

Then:

- **Matched:** 0.70 or above, with no materially different version close behind.
- **Ambiguous:** two or more plausible rows that cannot be separated. The person chooses.
- **No match:** nothing plausible. Another version is never substituted.

**Clean or explicit, when the track does not say:** P4 decided to take the explicit release, keep the clean one as an alternative, and record why in the evidence. Spotify exports never say. This is a deliberate exception to "show it instead of guessing" in [doc 06](06-person-4-catalog-social.md), to avoid a prompt on many songs. It means someone who saved a clean version may hear the explicit one, and they can correct it with `setMatchOverride`.

**With no duration,** two label releases of one title go to whichever the provider ranks first. This stopped obscure compilations tying with the album track.

## Measured quality

Run on 2026-10-31 against live YouTube Music, from one machine:

```sh
npm run match:eval -- --python path/to/python
```

The set has 51 labels in [tests/fixtures/matching/recordings.json](../tests/fixtures/matching/recordings.json), including remasters, live versions, covers, re-recordings, remixes, and tracks that should not match. Each ran twice, because Spotify exports have no durations.

| Run | Correct | Asked the user | Wrong | False accepts |
| --- | --- | --- | --- | --- |
| Holdout, first run, before any change | 27 of 31 with duration | 2 | 2 | 0 |
| All labels, final, with duration | 50 of 51 | 1 | 0 | 0 |
| All labels, final, no duration | 49 of 51 | 2 | 0 | 0 |

Median time was about 1.0 s, and the slowest was about 2.2 s.

How to read this:

- **The final row is not a clean holdout.** The first row is the honest out-of-sample number. After it, five rules were changed and one label was corrected (Clapton's "Layla" is acoustic too). One of the two first-run "wrong" results was that label error.
- **51 labels is small,** and we wrote them. These results show the approach works. They do not give a reliable error rate.
- **The provider varies between runs.** The correct "I Will Always Love You" appeared in some runs and not others, which moved that label between "correct", "asked the user" and, before a fix, "wrong".
- **Durations in the labels are from memory** and are only checked to within 5 seconds.
- **Clean variants are barely tested.** The one label only checks that a clean request does not resolve to the explicit recording.
- **A tribute act with a similar name is an open risk.** "Queen Machine" partly matches "Queen". A same-length official row by such an act could be accepted. No label covers it.

## Failures

| Situation | Result |
| --- | --- |
| HTTP 429 | `RATE_LIMITED`, retryable after 30 s. The real limit is unknown. |
| Network failure or 15 s timeout | `UNAVAILABLE`, retryable |
| Provider layout change, or an unexpected shape | `UNAVAILABLE`, retryable |
| Python missing, or worker crash | `UNAVAILABLE`. The next call restarts the worker. |
| Cancelled | `CANCELLED`. The worker's reply is dropped, because a call in flight cannot be stopped. |

The worker reads metadata only, with no cookies or accounts. It does not retry or back off, so a rate limit goes straight to the caller. That is task 9 and task 16.

## Requests to other owners

**Contract review, any affected owner:**

- `AppId` is now a UUID. Fixture IDs changed to match.
- `findCandidates` takes an optional `hint`, and there is a new `TrackHint`.
- New evidence signal: `source-ref`.

**P1:**

- The renderer uses numeric IDs and iTunes rows. Connecting it needs the `Track` shape, plus a preload bridge in `electron/`, which currently exposes only window controls.
- Show an ambiguous match as a choice, and offer a way to correct a match.

**P2:**

- Confirm a separate catalog worker is fine. P2's worker runs one job and exits, so it cannot serve search. Both use JSON lines and a protocol version.
- Package Python for both workers.
- Pass `hint` when resolving a playlist item.
- A stream resolver is still needed. See [doc 16](16-provider-spike.md).

**P3:**

- `explicit` and `album` in `TrackMetadataSnapshot` would remove the explicit guess for items saved in the app, and improve matching.
