# Person 1: error log

2026-10-31. Errors seen while integrating P2, P3 and P4 into the desktop app, with the exact message, cause and status. Newest first within each group. Verification context is in [17](17-person-1-verification.md). Integration details are in [22](22-person-1-integration.md) and menu details in [23](23-context-menus.md).

## Open

| # | Error message (exact) | Where | Cause | Owner and next step |
| --- | --- | --- | --- | --- |
| E1 | `Failed to load because no supported source was found.` | Toast when playing a track that is **not** downloaded in the desktop app (seen with "End Game") | Matching and resolving succeed: the stream resolves with a 4:05 duration. The HTML audio element then rejects the YouTube stream URL that P2's resolver returns. CSP is not the cause, because `media-src` allows `https:`. Not diagnosed further: probing the stream URL was blocked by this session's safety policy | **P2:** confirm whether the resolved URL can be played directly by Chromium. Downloaded tracks are not affected. Also seen for every P4 catalog search and album result, for example "The Great Pumpkin Waltz" from the album page, after 12 s |
| E2 | `Error invoking remote method 'p2:resolve-stream': Error: …` and `Error invoking remote method 'p2:download-track': Error: …` | Every desktop playback or download failure | Electron's IPC wrapper prefixes the original error, and the renderer shows the text unchanged | **P1 + P2:** P2 returns error codes (`NO_MATCH`, `UNAVAILABLE`, …) and P1 maps them to user-facing messages, as in `describeCloudError` |
| E3 | `Error invoking remote method 'p2:resolve-stream': Error: spawn C:\Users\USER\Documents\fyspoti\p2\.venv\Scripts\python.exe ENOENT` (same for `p2:download-track`) | Every desktop track and the Download button, on a machine where `p2/setup.ps1` has not been run | The P2 worker needs the `p2/.venv` Python environment, and there is no fallback to previews | **Worked around** on this machine by running `p2/setup.ps1`. Still open for new machines. **Decision needed (P1/P2):** fall back to previews or show a setup message. A release must bundle Python |
| E4 | No in-app error. Database round-trip not run | P3 cloud sign-in, cloud playlists, add-to-cloud, applying a Spotify import | Docker and the Supabase CLI are not installed, so `npm run cloud:start` cannot run. This is a blocked check, not a pass | **P3/P1:** run `cloud:start`, `cloud:reset`, `test:integration` on a machine with Docker, then exercise sign-in and import |
| E5 | No error. Wrong page title: the album artist link "Vince Guaraldi" opens an artist page titled "Vince Guaraldi Trio" | Album page → artist link (catalog album "It's The Great Pumpkin, Charlie Brown") | P4 data: the album's artist credit carries the ID of a different YouTube Music artist channel than its display name | **P4:** check `artistFromRow` and the album artist IDs |

## Fixed

| # | Error message (exact) | Where | Cause | Fix |
| --- | --- | --- | --- | --- |
| F1 | `Error invoking remote method 'p2:resolve-stream': Error: NO_MATCH: No confident recording match` | Playing any catalog track from a list in the desktop app. Downloads of the same track matched | Queue items had no `durationMs`, so P2's adapter assumed `180000` ms. P4's matcher then rejected the real recording (for example 2:36) on duration | `itemFor` in `src/main.tsx` passes the catalog duration. Verified: the track played 0:01 → 0:05 of 2:36 |
| F2 | `spawn … ffprobe ENOENT`, expected but not observed because the cause was fixed first | Download verification (`worker.py verify`) | `ffprobe` was not installed. Electron main uses `FYSPOTI_FFPROBE` or the bare `ffprobe` | Installed FFmpeg 9.0.2 (`winget install Gyan.FFmpeg`). `launch.ps1` rereads the saved PATH and warns if `ffprobe` is missing. Verified: a download passed verification |
| F3 | yt-dlp JS runtime missing, prevented before it was observed | P2 worker runs `yt-dlp --js-runtimes node` | `node` is not on the system PATH here, only a bundled runtime | `launch.ps1` puts the Node runtime it found on Electron's PATH |
| F4 | Submenu opened with focus on nothing (`document.activeElement` null) | Track menu → Add to playlist, opened with → or Enter | Focus was attempted while the submenu was still `visibility:hidden` during measurement | Focus moves after placement (`src/ContextMenus.tsx`). Verified live |
| F5 | `Uncaught ReferenceError: React is not defined` | Opening the Queue or Connect panel (present since the first UI draft) | Vite compiled JSX in classic `React.createElement` mode, because it does not read `tsconfig.frontend.json` | `esbuild: { jsx: 'automatic' }` in `vite.config.ts` |
| F6 | `TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')` | Starting Electron from a VS Code terminal | VS Code sets `ELECTRON_RUN_AS_NODE=1`, so `electron.exe` starts as plain Node | `launch.ps1` removes the variable before launching |
| F7 | `error TS2339: Property 'message' does not exist on type '{ type: "buffering" \| "ended" \| "playing"; … }'` (`p2/src/player.ts`) | `npm run check` once the frontend typecheck included P2's player | TypeScript cannot narrow a trailing `else` to the `error` event | `else if (event.type === 'error')`, with identical behavior. P2 review requested in 22 |
| F8 | P2's `player.ts` imports `node:crypto`, which has no browser build | Renderer bundle | The sandboxed renderer has no Node modules | Vite alias to `src/shims/node-crypto.ts` (Web Crypto). P2 asked to use `globalThis.crypto` |
| F9 | Merge conflict in `src/main.tsx` | Merging P2's desktop-playback work (`41d60ee`) | Both sides edited the context-menu block | Kept P1's desktop-derived menus and re-applied P2's `removeUpcoming` queue removal and "Add local files" |

## Test-harness artifacts (not app bugs)

| Message | Cause | Avoid by |
| --- | --- | --- |
| `{"ok": false, "error": "Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)"}` | Piping JSON into `p2/worker/youtube_source.py` from Windows PowerShell 5.1, which adds a byte-order mark. The app sends plain UTF-8 | Pipe from Git Bash (`printf '%s\n' '{…}' \| p2/.venv/Scripts/python.exe p2/worker/youtube_source.py`) |
| `node: command not found` / `npm: command not found` | No system Node.js on this machine | Use the bundled runtime that `launch.ps1` finds, or install Node 24 |
| REA `analyze-web-bundle` returned 0 sources | The page had finished loading before observation started | Start observation before loading the page. See [23](23-context-menus.md#what-could-not-be-recovered) |
