# Moving a user's Spotify data into fyspoti

Owner: P4 for reading and matching, P3 for storage and account connections, P1 for the screens. Code is in [packages/catalog](../packages/catalog/src/spotify-import).

## Status

| Part | Status |
| --- | --- |
| Read Spotify's "Download your data" ZIP | Built. Tested on 15 real files from public repositories (see below). |
| Preview before writing | Built |
| Write into P3's library as new private playlists | Built, and tested through P3's real adapter with a faked server. Not run against a real database. |
| Import screen | Not built (P1, or P4 with P1 components) |
| Sign in with Spotify | Not built. Needs a Spotify developer app (see below). |
| Matching imported rows to playable audio | Built in the catalog. See [doc 22](22-catalog-core.md). Not yet called from the import flow. |

**Imported tracks will not play yet.** This moves a user's library structure into the app. `findCandidates` can now match a row from its snapshot, but no stream resolver or import screen exists.

## Two routes

| | Data export file | Sign in with Spotify |
| --- | --- | --- |
| Users | Anyone | 5 allowlisted users in Development Mode |
| Setup | None | A developer app owned by a Premium account |
| Wait | Spotify prepares the file. The help pages we read give no timing. | Instant |
| Live link | No, a one-time snapshot | No, must remain a one-time transfer (below) |
| Data quality | Names and URIs. No durations or ISRCs. | Richer, but unverified since the 2026 API changes |
| Rules | Spotify's own privacy tool, for the user's own data | [Developer Policy](https://developer.spotify.com/policy) applies |

The export route is built first because it works for everyone with no credentials. Request an export now if the demo needs real data, as the wait is unknown.

## How a user does it

1. On the [Spotify account privacy page](https://www.spotify.com/account/privacy/), use **Download your data** and choose **Account data**.
2. When the email arrives, download the ZIP.
3. Choose it in fyspoti, review the preview, and confirm.

To check an export today, without uploading anything:

```sh
npm run import:preview -- path/to/my_spotify_data.zip
```

It prints counts only, so the output is safe to share.

## What moves

| Data | Result |
| --- | --- |
| Playlists | New private playlists. Order and duplicates are kept. |
| Liked Songs | A private playlist called "Liked Songs (from Spotify)", because P3 has no likes API yet |
| Saved albums and artists | Counted in the preview, not imported until P3 has an API for them |
| Podcast episodes, audiobooks | Skipped, because the app has no podcasts or audiobooks. Counted in the preview. |
| Local files | Skipped and counted. The export has no path to the file. |
| Playlist descriptions, album names | Dropped, because P3's tables have no column for them |
| Listening history | Not read yet |
| **Account details** | **Never read.** App accounts stay separate, as doc 10 requires. |

## Privacy

The ZIP also holds email, date of birth, address, phone number and payment files. `read-archive.ts` allows only `Playlist*.json` and `YourLibrary.json` to be decompressed, so those other files never reach memory, logs or the cloud. A test proves this using decoy files.

Parser errors name files and fields only, never user content.

## Behavior worth knowing

- **Provisional IDs.** P3 requires a UUID and no catalog exists yet, so each row gets a UUIDv5 derived from its Spotify URI, or from its title, artist and album in older exports with no URIs. The same track always gets the same ID within a route, but a URI row and a text row for one song get different IDs. This is a placeholder, not a canonical recording identity.
- **Durations are 0.** The export has none, and 0 passes P3's validation. Consumers must show this as unknown.
- **Never overwrites.** Each import creates a new playlist. Importing twice creates a second copy.
- **Failures stop, and do not retry.** P3's writes have no idempotency guarantee yet. The result says how far it got, and the caller can resume into the same playlist.
- **Layout changes fail loudly.** If every row in a list is unreadable, the import stops rather than reporting an empty success.

## Tested against real exports

Spotify documents what the [export contains](https://support.spotify.com/us/article/understanding-my-data/), not its field layout. So the parser was run on 15 real files that people published in public GitHub repositories: 8 `Playlist1.json` and 7 `YourLibrary.json`. Each went through the ZIP reader with a decoy account file beside it. The files stayed in memory and nothing was saved.

| Result | Count |
| --- | --- |
| Files imported | 15 of 15 |
| Playlists | 41 |
| Tracks ready | 1,764, including 469 liked songs |
| Unreadable rows | 0 |
| Podcast episodes correctly skipped | 2 |

This testing found one real bug. Older exports have no `uri` in `YourLibrary.json`, which rejected 3 of the 7 files. Those rows now import using their text.

Still not covered:

- **A whole real ZIP.** The samples were loose files, so the folder layout of a real download is unconfirmed. The reader ignores folders, so this should not matter.
- **Local files and audiobooks.** No sample contained either, so their field layout is unconfirmed. They are detected without reading their fields.
- **A real database.** Writes were tested through P3's adapter with a faked server. Docker and hosted credentials were not available.

Run `npm run import:preview` on a real download to cover the first point.

## Requests to other owners

**P3:**

- A batch insert. Each `addPlaylistItem` makes three requests, so a 5,000-track playlist means about 15,000 requests.
- `album` in `TrackMetadataSnapshot`, which would improve later matching.
- A likes API, then saved albums and artists.
- A way to mark duration as unknown instead of 0.
- A plan for replacing provisional track IDs once the catalog can match them.

**P1:** an import screen covering file choice, preview counts, and interrupted or partial results.

## Adding "Sign in with Spotify" later

Allowed, with limits. The Developer Policy (III.9) bans transferring data to another service, except "enabling a user to transfer their personal data, or the metadata of the user's playlists". It does not explicitly mention saved tracks.

Needed to build it:

- Someone with Spotify Premium registers a developer app and adds each tester to its allowlist.
- [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), so no client secret ships in the app.
- A [redirect URI](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) of `http://127.0.0.1:PORT`. `localhost` is not allowed.
- An easy way to disconnect, and deletion of that user's personal data when they do (I.1.2).

Limits:

- **One-time transfer only.** A lasting connection inside a player that streams from other sources conflicts with III.5, and III.11 bars replicating Spotify's core experience without permission. The exception covers moving data, not an ongoing link.
- [Development Mode](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) is not a basis for a product, and Spotify could revoke access.
- `GET /me` no longer returns email or country, and playlist contents come back only for the user's own playlists, per the [February 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).
- In a public repository, each deployment needs its own Client ID. Never commit a shared one.
