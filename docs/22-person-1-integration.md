# Person 1: integrating P2, P3 and P4 into the app

2026-10-31. After merging the Spotify import work (`b5f8446`), the renderer was connected to the teammate modules instead of its own stand-ins. Nothing in `packages/` or `services/` was changed. One line in P2's `player.ts` was changed and needs P2 review (see below).

## What changed

| Area | Before | Now | Owner module used |
| --- | --- | --- | --- |
| Track model | Number index into an iTunes array | Shared `Track`/`Album` contracts, validated with their schemas. App-owned UUID track IDs | `@fyspoti/contracts` |
| Track IDs | Array position | `provisionalTrackId` over P4's text identity key, so an older Spotify export row for the same song gets the same ID | `@fyspoti/catalog` |
| Catalog | iTunes fetch inside `main.tsx` | Interim adapter `src/services/catalog.ts`. Preview URLs are stored beside tracks, never inside them. Replace with P4's `CatalogApi` when it exists | P1, interim |
| Playback | React `<audio>` with queue arrays in component state | P2 `Player` + `BrowserAudio`. The UI draws `PlayerState` and issues commands. It keeps no second queue | `p2/src/player.ts` |
| Desktop playback | None | `createRendererPlayer` through P2's bridge: offline-first artifacts, local-file URIs, session restored on restart | `p2/src/renderer-player.ts` |
| Queue panel | Indexes into the catalog | P2 queue items with stable item IDs, so duplicates work. Reorder calls `reorderQueue` | P2 |
| Sleep timer, shuffle, repeat, seek, volume, previous/next | Local state | `sleepAfter`, `setShuffle`, `setRepeat`, `seek`, `setVolume`, `previous`, `next` | P2 |
| Cloud library | "Awaits Person 3" toast | Sign-in dialog, cloud playlists in Your Library, playlist page from snapshots, "Add to … (cloud)", "Create cloud playlist" | `@fyspoti/library` (loaded lazily) |
| Spotify import | Not built | Import page: steps, file choice, preview counts, per-list selection, apply, interrupted/resume results | `@fyspoti/catalog` + P3 `Library` |
| Electron shell | Plain `.cjs`, no CSP | TypeScript `electron/main.ts` and `preload.ts`, bundled to `dist-electron/`. Hosts P2 desktop services. Restrictive CSP. External links open in the system browser and in-app navigation is blocked | P2 `electron-main.ts`, `electron-preload.ts` |

Local playlists, likes, covers and profile keep using browser storage. Drafts stored catalog positions as track IDs, and these are migrated to the new UUIDs automatically on first load (verified on an existing profile).

## Files

- `src/services/catalog.ts`, `playback.ts`, `cloud.ts`: service boundary between the UI and teammate modules.
- `src/SpotifyImport.tsx`, `src/import.css`: import screen.
- `src/PlayerPanels.tsx`: queue rows are now P2 queue items.
- `src/shims/node-crypto.ts`, `vite.config.ts`: maps P2's `node:crypto` import to Web Crypto in the renderer, injects the CSP, and enables the automatic JSX runtime.
- `electron/main.ts`, `electron/preload.ts`, `vite.electron.config.ts`, `tsconfig.electron.json`.
- `package.json` (scripts and `main` only, no dependency changes) and `launch.ps1`.
- `tests/unit/renderer-catalog.test.ts`.

## Bug found and fixed

Vite compiled JSX in classic `React.createElement` mode because it does not read `tsconfig.frontend.json`. Components without `import React`, the Queue and Connect panels, threw `React is not defined` when opened. This bug was already in the first draft. Fixed with `esbuild.jsx: 'automatic'`.

## Behavior to know

- **Playing from a list** queues the chosen track and the rest of the visible list after it, in the displayed order. P2 then owns order, repeat and shuffle.
- **Add to queue** uses P2's `enqueue`, which places the item next. Several additions therefore play newest-first.
- **Remove from queue / Clear queue** call P2’s `removeUpcoming` (added in the P2 merge `41d60ee`; verified live: 9 → 8 rows).
- **Cloud playlists are read and append only.** P3 M0 has no rename, delete, reorder, remove, cover or description. Those actions explain this instead of editing a copy. Items not in the loaded catalog render from their metadata snapshots, and unknown durations (0) show as `–:––`.
- **Cloud sessions are in memory.** Restarting requires signing in again, as documented by P3.
- **Imported tracks do not play.** They have no audio match yet, so playing one reports that no audio source is connected.
- **Cloud configuration** comes from build-time `VITE_FYSPOTI_CLOUD_URL` and `VITE_FYSPOTI_CLOUD_KEY`. Only a publishable or anon key may be used, and P3's adapter rejects secret and service-role keys. Without these, the Supabase client is left out of the bundle entirely.
- **Downloads** remain unavailable. P2 requires explicit tool paths (`FYSPOTI_PYTHON`, `FYSPOTI_FFPROBE`, optional `FYSPOTI_FFMPEG`, `FYSPOTI_SPOTDL`) and never falls back to global tools. No renderer path enqueues jobs, because P2 accepts only main-process authorized requests and there is no permitted download source yet.
- In the desktop app, volume starts at P2's default of 100% rather than the old 50%.

## Requests to other owners

**P2 (review needed):**

- Review the one-line change in `p2/src/player.ts`: the final `else` in `onAudio` is now `else if (event.type === 'error')`. Behavior is identical. TypeScript could not narrow `event.message` in a trailing `else`, which failed the frontend typecheck now that it includes the player.
- Use `globalThis.crypto.randomUUID` instead of importing `node:crypto` in `player.ts`, so the renderer shim can be removed.
- ~~Queue remove/clear command~~: delivered as `removeUpcoming`.
- Consider appending manual `enqueue` items after earlier manual items, Spotify-style.
- `p2/package.json` pins Electron 45.1.0, while the app runs the root 45.2.1.

**P3:** `update`/`delete`/reorder/remove item, likes, and the desktop session service, so cloud playlists can be edited and stay signed in. Please review the error messages in `src/services/cloud.ts`.

**P4:** a `CatalogApi` implementation to replace `src/services/catalog.ts`, and a `CatalogSourceAdapter` for real streams. Album and artist IDs in the interim adapter are UUIDv5 values under a P1 namespace and should be replaced by canonical ones.

## Verification

See [verification](17-person-1-verification.md#team-integration-pass).

## After the P2 desktop-playback merge (41d60ee)

Desktop playback and downloads now resolve through P2’s YouTube worker (`p2/.venv`, created by `p2/setup.ps1`). Without that environment every desktop track fails to play with a raw IPC `spawn … python.exe ENOENT` toast; there is no fallback to previews. The browser (`npm run dev`) view still uses previews.


Errors and their status: [24-person-1-error-log.md](24-person-1-error-log.md).

## P4 catalog integration

2026-10-31. P1's UI now uses P4's catalog (`packages/catalog`) in the desktop app.

| Part | How |
| --- | --- |
| Host | `electron/catalog.ts` runs `createCatalog` with P4's YouTube Music worker (`services/catalog-worker/worker.py`) in the main process. Python comes from `FYSPOTI_CATALOG_PYTHON`, otherwise P2's `p2/.venv`, which already pins `ytmusicapi==1.12.1` |
| IPC | `catalog:search`, `catalog:get-track`, `catalog:get-album`, `catalog:get-artist`, `catalog:find-candidates`. Each checks that the sender is the app's main frame and validates UUID IDs, query length (1–200), cursor and `TrackHint`. Results cross IPC as `Result` values. Tests: `tests/unit/desktop-catalog-ipc.test.ts` |
| Bridge | `window.desktop.catalog` (`CatalogBridge` in `src/services/desktop-catalog.ts`, kept out of `packages/contracts` to avoid a contract change). `@fyspoti/*`, `zod` and `fflate` are bundled into `dist-electron/main.cjs`, because the packages are ESM-only |
| Search | Debounced (350 ms) catalog search with Songs, Artists and Albums sections and the All/Songs/Albums/Artists chips. Shows a loading state, an error with Retry for each error code, and `No results found for "…"`. Stale replies are dropped. The browser build keeps the loaded-catalog filter |
| Album page | `calbum/<id>`: `getAlbum` plus `getTrack` for each track. Hero with kind, artists, year and count. Play, shuffle, download and more options. Rows fall back to the album cover, and long titles shrink and wrap |
| Artist page | `cartist/<id>`: `getArtist`, plus that artist's songs from `search(name)`. A full discography needs a P4 contract change |
| Registry | Catalog tracks are added to a per-device registry (`fy-catalog-seen`, capped at 500), so play, queue, like, add-to-playlist and download all work. "Go to artist/album" opens catalog pages for catalog tracks |

Our UI shows in the desktop app only when built with `VITE_FYSPOTI_DESKTOP_MODE=prototype`. P3's `CloudApp` is the default (see the decision noted after merge `caca34a`).

Not done:

- **Match choice and correction** (P4's request). Desktop playback resolves audio through P2's own matcher, not P4's `findCandidates`, so choosing or correcting a match in the UI would not change what plays. This needs P2 to resolve from P4's accepted candidate first. `findCandidates` is bridged and ready.
- Recommendations on Home (P4 task 12 is not built).
- Search paging beyond the first page (14 songs, 4 albums, 2 artists).

Requests:

- **P4:** update "Connected to the app" in [22-catalog-core.md](22-catalog-core.md). Look at the artist credit in E5.
- **P2:** resolve playback from P4's accepted candidate, so the match UI can be built.
