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
| Survives a restart | Built (task 9), once the app opens the file store. See [Saved data](#saved-data). |

## How to use it

Run this in Electron main or Node, because it starts a Python process. The renderer reaches it through a preload bridge, which does not exist yet.

```ts
import { createCatalog } from '@fyspoti/catalog';
import { createYtMusicWorker } from '@fyspoti/catalog/youtube-worker';

import { openFileCatalogStore } from '@fyspoti/catalog/file-store';

const worker = createYtMusicWorker({ python, workerPath });
const store = await openFileCatalogStore({ path: join(app.getPath('userData'), 'catalog.json') });
const catalog = createCatalog({ ytMusic: worker, store });

const page = await catalog.search('some song', null);
const match = await catalog.findCandidates(trackId);

// Before quitting:
await store.flush();
worker.close();
```

Without `store`, the catalog keeps everything in memory and forgets it on restart.

Install the worker's dependencies with `pip install -r services/catalog-worker/requirements.txt`. A packaged app needs to ship that Python, which is the same job as P2's worker.

Every catalog method resolves to a `Result`, so check `ok`. P3's `Library` throws `LibraryError` instead. Both are deliberate, and code that calls both has to handle both.

For a track from a playlist or an import, pass its snapshot:

```ts
await catalog.findCandidates(item.trackId, { hint: item.metadataSnapshot });
```

The catalog only knows tracks it has seen on this install. Without the hint, a synced or imported track returns `UNAVAILABLE`.

## Saved data

Tracks, albums, artists, matches and corrections are saved to one device-local JSON file. It holds no audio, stream URLs or credentials, and it never goes to the cloud. It's shared by every account on a device, which is fine for catalog data. Corrections are the one personal item.

| Data | Refreshed after | During an outage |
| --- | --- | --- |
| Search results | 5 minutes, held in memory only | Old results are shown |
| Album, artist | 7 days | Old copy is shown |
| Track | Never refreshed by ID | Old copy is shown |
| Match that succeeded | 30 days | Old match is used |
| Ambiguous match | 1 day | Old result is used |
| No match | 1 hour, because the fault may have been temporary | Old result is used |
| Correction | Never expires, and is never dropped | Kept |

- `catalog.freshness(id)` gives the save time and whether the copy is stale, so a screen can say so. It is on `Catalog`, not in the shared contract, so `CatalogApi` is unchanged.
- **Limit:** 50,000 of each kind. The oldest go first. A dropped track can be found again by search or by its snapshot.
- **Saving** happens about 2 seconds after a change, through a temporary file. Call `flush()` before quitting, or the last 2 seconds are lost. A failed save is reported to `onSaveError`, and search and playback carry on.
- **Unreadable file:** it's renamed to `catalog.json.unreadable` and the app starts empty, so corrections can still be recovered by hand. A single bad record is dropped alone.
- **JSON, not SQLite,** because SQLite needs a native dependency and a lockfile change. The whole file is rewritten on each save. At 50,000 tracks that was 37 MB and 114 ms of blocked main process per save, measured once. That is fine for a demo, and normal use stays far smaller. `CatalogStore` is an interface, so SQLite can replace it.
- **A correction can be lost to provider variation.** `acceptSourceId` only applies when that row comes back in a search, and results vary between runs. A saved match covers it for 30 days.

## Backoff

After a rate limit, the catalog stops calling YouTube Music for 30 seconds, then doubles the wait each time up to 10 minutes. One success resets it. `retryAfterMs` gives the real time left, so a screen can show it. Saved data still works during the wait.

Only rate limits trigger this. An outage has no wait, so a person can retry at once.

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
| HTTP 429 | `RATE_LIMITED`, with the wait in `retryAfterMs`. The real limit is unknown. |
| Network failure or 15 s timeout | `UNAVAILABLE`, retryable |
| Provider layout change, or an unexpected shape | `UNAVAILABLE`, retryable |
| Python missing, or worker crash | `UNAVAILABLE`. The next call restarts the worker. |
| Cancelled | `CANCELLED`. The worker's reply is dropped, because a call in flight cannot be stopped. |

The worker reads metadata only, with no cookies or accounts. Failures with no saved copy to fall back on go to the caller. The screens that show them are task 16.

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
