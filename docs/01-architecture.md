# Architecture and shared contracts

Owners: all four. Changes require review by one affected owner, not a central lead.

## Recommended stack (proposal)

Use TypeScript, React and CSS for the renderer; Electron for Windows packaging and desktop integration; SQLite for local cache/outbox; managed PostgreSQL, authentication and object storage for cloud data. Supabase is a candidate backend, subject to an initial access, policy and cost spike. Use a packaged Python worker around a pinned spotDL version for download experiments, communicating over framed JSON messages on stdio. Keep streaming resolution behind a separate adapter.

This recommendation prioritizes precise desktop UI work and a shared language across most modules. It adds Chromium memory/installer overhead and a Python distribution to maintain. It is a new app architecture, not Spotube's current Kotlin stack. Validate playback formats, Windows packaging and worker startup before committing to it. A web renderer audio engine is the first spike; if codec, seeking or gapless requirements fail, select a native engine behind the same Player interface before feature development expands.

Electron [process model](https://www.electronjs.org/docs/latest/tutorial/process-model) and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) support separating renderer, preload and privileged operations. Use context isolation, renderer sandboxing, no renderer Node access, restrictive CSP and validated IPC. Do not render arbitrary provider HTML with desktop privileges.

## Proposed repository boundaries

```text
apps/desktop/renderer/       # P1 shell/components; owners add feature panels
apps/desktop/main/          # P2 playback/worker lifecycle; P3 storage/session services
apps/desktop/preload/       # Typed, narrow bridges; review by affected owner
packages/contracts/        # Shared schemas and generated types
packages/player/           # P2
packages/catalog/          # P4
packages/library/          # P3
packages/social/           # P4
services/download-worker/  # P2, Python
services/cloud/            # P3 personal data; P4 social tables/functions
tests/fixtures/            # Small rights-cleared fixtures
```

## Identity and API rules

- `Track`: app-owned `id`, title, artist IDs, album ID, durationMs, explicit status, optional ISRC, version flags, artwork and provider references. Never use a transient stream URL as identity.
- `SourceCandidate`: provider, sourceId, trackId, durationMs, version evidence and confidence. P4 owns recording identity; P2 owns playback resolution.
- `PlayableSource`: candidate ID, URI, expiry, MIME/codec, seekability and supported capabilities. Device-local and transient; never cloud-sync URIs or credentials.
- `PlaylistItem`: stable item ID, playlist ID, track ID and ordering key. Support intentional duplicate tracks.
- `PlayerState`: generation, state, current queue-item ID, positionMs, durationMs, volume, repeat mode, shuffle state, buffering/error details.
- `DownloadJob`: ID, track ID, candidate ID, state, byte progress, error and local artifact ID. Paths remain device-local.
- `LibraryMutation`: UUID, user ID, entity ID, operation, expected revision and payload. Server assigns accepted revisions.
- `ListeningEvent`: UUID, user ID, track ID, session ID, listenedMs, timestamp and privacy eligibility. P2 emits, P3 persists, P4 aggregates.
- All list APIs return stable cursor pagination. Errors use codes such as UNAVAILABLE, AUTH_REQUIRED, RATE_LIMITED, NO_MATCH, CONFLICT and DISK_FULL, with retryability.
- Commands: `play(trackId, context)`, `pause`, `seek(ms)`, `setQueue`, `enqueue`, `reorderQueue`, `setRepeat`, `setShuffle`; replies/events carry a generation to discard stale work.
- Downloads: `enqueueDownload(trackId)`, `cancelDownload(jobId)`, `retryDownload(jobId)`, `removeArtifact(artifactId)` and observable job updates.
- Catalog: `search(query, cursor)`, `getTrack`, `getAlbum`, `getArtist`, `getRecommendations(context)` and `findCandidates(trackId)`.

## End-to-end flow

Search -> canonical track -> candidate match -> stream resolution -> player. A download resolves the same recording but uses an independent job pipeline. Library actions store canonical IDs and sync metadata references; offline playback uses a complete local artifact first. A source outage must not erase the user's library.

## Build order and acceptance

1. All owners agree schemas and fixtures; each creates one mocked consumer/provider test.
2. P1 boots shell; P2 plays a cleared fixture and starts worker; P3 round-trips a cloud playlist; P4 returns canonical search results.
3. Connect real adapters and handle failure states before adding advanced parity.
4. Prove search -> stream -> save -> download -> quit -> restart offline -> play; then sign in on another installation and verify playlist sync.

Release only after packaged Windows testing confirms renderer isolation, worker cleanup, migration safety and account isolation. No launch stream should depend on downloading a whole track first.
