# M0 provider spike

Owner: P4, with P2 for audio. Run 2026-10-31 from one Windows machine and one IP address. Raw measurements are in [spikes/m0-providers/results](../spikes/m0-providers/results), and anyone can rerun them.

## Outcome

| Role | Selected | Status |
| --- | --- | --- |
| Canonical metadata and IDs | MusicBrainz, plus Cover Art Archive for artwork | Works. Core data is CC0. |
| User-facing search and audio candidates | YouTube Music through ytmusicapi | Works, but is an **exception to our provider rule** (below). |
| Stream resolution (P2) | yt-dlp | Works on a rights-cleared video. Same exception. |
| Lyrics | LRCLIB | Works. Data license not confirmed. |
| Browse data | ListenBrainz, plus YouTube Music radio and moods | Works. ListenBrainz terms not read. |
| Permitted-content fallback | Internet Archive Creative Commons items, then Audius, then local files | Works. |

The full list of what each source can do is in the [capability matrix](17-provider-capability-matrix.md).

## The exception the team needs to know about

[Doc 13](13-catalog-and-discovery.md) and [doc 02](02-upstream-references.md) say to select providers only after proving authorized access. **YouTube does not pass that test.** YouTube's [Terms of Service](https://www.youtube.com/static?template=terms) prohibit downloading content without authorization and accessing the service by automated means. The YouTube API terms grant no right to reproduce or distribute audiovisual content. yt-dlp and ytmusicapi are unofficial clients.

Person 4 chose this route because no authorized source available to us carries the mainstream catalog. It is a recorded decision to accept that risk, not a finding that access is permitted. Because this replaces P2's source plan and contradicts doc 13, **P2 and the other owners should confirm it.**

What this means in practice:

- A build can break whenever YouTube changes something. `get_charts` already failed during this spike with a parser error.
- Google or a rights holder could act against the project. A public repository is more exposed than a private demo.
- The MIT license on our code does not change any of this, and it gives nobody rights to the music.

Safeguards in place:

- Every candidate carries `accessBasis: 'unofficial-extraction'`, so the source can be disabled without touching match logic.
- Tests fetch no copyrighted audio. Coverage checks read search metadata only, and the stream test uses one CC BY video.
- No cookies, accounts or bot-check workarounds are used. If YouTube refuses a request, that is the result.

## What was measured

Twenty labeled recordings: 14 mainstream, 4 international and 2 long-tail, including live, remaster, radio-edit and intended-cover targets. A provider "found" a recording when title, artist, version and duration (within 5 seconds) all fit.

| Search | Found | First result | Top 5 | Median | Slowest |
| --- | --- | --- | --- | --- | --- |
| YouTube Music | 20/20 | 19 | 20 | 1.0 s | 1.9 s |
| Deezer | 20/20 | 20 | 20 | 0.3 s | 0.6 s |
| MusicBrainz, structured query | 17/20 | 6 | 12 | 0.7 s | 5.1 s |
| MusicBrainz, free text | 6/20 | 2 | 3 | 0.4 s | 5.0 s |

What the numbers mean:

- **MusicBrainz cannot be the search box.** It is a strong source of identity, but it does not rank by popularity. For structured queries, the studio "Bohemian Rhapsody" came 22nd. Only 10 of the 17 matches carried an ISRC. Use it for canonical IDs, and expect mapping from a search hit to a MusicBrainz recording to need the scoring in task 7.
- **Duration alone is not enough.** YouTube Music returned at least one same-title result within 5 seconds of the target for 17 of the 20 recordings. For Queen's song that included covers.
- **Open-upload sites can surface likely rips.** Audius returned 7 results for "Queen Bohemian Rhapsody". None came from a verified account, none had an ISRC, and 5 were within 2 seconds of the studio length. A search hit there is not evidence of rights.
- **MusicBrainz has no explicit flag.** Our contract needs an `unknown` state, and YouTube Music's flag fills part of the gap.

Other checks:

| Check | Result |
| --- | --- |
| yt-dlp on a CC BY video | Resolved in 3–5 s. AAC in m4a. URL valid for 6 hours. Mid-file request returned `206`. |
| Internet Archive CC item | Mid-file request returned `206`. 44 of 500 sampled items were CC BY, BY-SA or CC0. |
| Audius | Streamed with no key and returned `206`. 13 of 25 trending tracks had verified uploaders, and 4 of 25 allowed download. |
| LRCLIB | 18 of 20 synced, 1 plain only, 1 missing. The missing one was a `503` server error even after one retry. |
| Cover Art Archive | Worked on all retries at 1.7–5.4 s, with one `500` on an earlier run. Needs lazy loading, caching and a placeholder. |
| MusicBrainz paging | Two pages had no overlap. Offsets will sit behind an opaque cursor. |

## Rejected options

| Source | Why not |
| --- | --- |
| Spotify Web API | The [Developer Policy](https://developer.spotify.com/policy) bans integrating with another service's streams (III.5) and replacing Spotify's core experience (III.11). [Development Mode](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) allows five users, and [extended quota](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) needs a registered organization and 250k monthly users. |
| spotDL | Its `Spotdl` entry point needs Spotify credentials, which runs into the policy above, and it ships a default Spotify client ID. [Doc 10](10-accounts-and-cloud.md) already rules out embedding secrets like that in distributed code. ytmusicapi and yt-dlp give us the same audio route directly. **The final call is P2's.** |
| Deezer | Best results in this test, but its [terms](https://developers.deezer.com/termsofuse) limit use to private, non-commercial use, and developers report that new app registration is closed. That does not fit code anyone may reuse. Not adopted. |
| SoundCloud | Its [API terms](https://developers.soundcloud.com/docs/api/terms-of-use) ban aggregated on-demand services, mixing with other sources and offline access. |
| Jamendo | Needs a client ID (untested). Non-commercial only, and its [terms](https://devportal.jamendo.com/api_terms_of_use) bar apps built to cache content for offline access. Possible later for streaming only. |
| Reverse engineering Spotify's client | Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) prohibit reverse engineering, circumventing its technology and ripping. Going after protected audio is a different level of risk from a terms breach, and it would not answer any open question here. Not an option for this project. |

## Public repository rules

The code is public under the MIT license. That license covers only what we wrote.

**Never commit:** credentials or client IDs; audio; lyrics text; cover art; Spotify logos or copied assets; signed stream URLs; provider response dumps; MusicBrainz tags, ratings or annotations, which are CC BY-NC-SA and incompatible with MIT. Fixtures stay invented or come from CC0 core data, as `tests/fixtures/catalog` does.

**Each person running the app is responsible for their own provider use.** The repository should say so, and it must not ship anyone's shared API credentials.

**Actions:**

- Sign the project up with [MetaBrainz](https://metabrainz.org/supporters/account-type). It asks open-source developers to register under its non-profit tier, listed from $0.
- Send an identifying `User-Agent` to MusicBrainz and LRCLIB. Use the repository URL, not a personal email address.
- Review the name "fyspoti" before going public, as it closely resembles a trademark. The README already lists naming as open.

## Unverified

- **Terms not read, because the pages would not load:** Audius, Internet Archive and ListenBrainz. Read all three before relying on them.
- **LRCLIB:** publishes no data license. Lyrics belong to their rights holders, so treat them as display-only and keep them out of the repository.
- **Cover Art Archive images:** CC0 does not cover them. Link to them, and do not store them in the repository.
- **Deezer registration:** the closed status comes from developer reports, not from Deezer.
- **Load:** nothing was tested at sustained volume, from a second network or in another country. YouTube Music's real limits are unknown.
- **Sample size:** 20 recordings is a spike, not a quality measure. The labels are ours, and two durations were corrected against MusicBrainz and Deezer after a first run. The acceptance check is deliberately simple. Task 7 replaces it.

## Work this creates for P2

- yt-dlp needs a JavaScript runtime for YouTube. System Node worked here, but a packaged app has none, and using Electron's is untested.
- yt-dlp needs frequent updates to keep working, which conflicts with doc 02's rule against silently installing floating runtimes. An explicit update path is required.
- Stream URLs last about 6 hours, so `PlayableSource` expiry must be handled during long sessions.

## Versions used

yt-dlp 2026.10.26 (Unlicense), yt-dlp-ejs 0.8.0, ytmusicapi 1.12.1 (MIT), spotDL 4.6.0 (MIT, inspected only), Node 24.22.1, Python 3.12.10. Upstream documentation was read on 2026-10-31.
