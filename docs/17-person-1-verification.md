# Person 1 verification

2026-10-31

- Production TypeScript/Vite build passed after correcting an Error setter name collision.
- npm audit reported zero vulnerabilities after updating Electron to 45.2.1.
- Chrome visual inspection: three-column desktop shell, red Home gradient, real online artwork and persistent player rendered.
- Real catalog loaded eight tracks including The Great Pumpkin Waltz, End Game, You're Such A, I Did Something Bad and Say You Won't Let Go.
- Navigated from library to all time playlist; real titles, albums and durations rendered.
- Opened edit dialog, changed description, saved, reloaded and verified persistence; restored original description.
- Played collection: player switched to Pause, timeline advanced to six seconds and seven next-up queue items appeared. Playback was paused after the check.
- Video browser inspection succeeded after research fetch failed. Title: Design in Figma - Recreating the Spotify UI, CodeWithChris. Opening frame shows mobile player/lyrics Figma designs, not the supplied Windows desktop screens. Full 27-minute video was not reviewed frame by frame.

Not yet verified: full Electron window interaction, Windows DPI variants, precise screenshot diff parity, keyboard focus trapping, all edge cases for playlist drag/drop, full-song audio, downloads or cloud sync. Those backend features are not implemented here.

REA pass: production build passed; browser verified keyboard panel resizing (368 -> 384px) and dialog Tab wrap to Close. See 18-spotify-rea-investigation.md for exact target, evidence and limits.


Launcher fix: launch.ps1 now checks PATH, then the existing Codex-bundled Node runtime. Added -BuildOnly for verification without opening a window.



## Team integration pass

2026-10-31, after merging `b5f8446`. Details in [22-person-1-integration.md](22-person-1-integration.md).

Passed:

- Typecheck: `tsc -b`, frontend, tests and the new `tsconfig.electron.json`.
- Unit tests: 41 root tests, including 4 new adapter tests (contract-valid tracks, no stream URL inside `Track`, provisional IDs shared with the importer, cache schema rejection). Also 17 contracts tests and 6 P2 tests.
- Builds: renderer, Electron main and Electron preload. The preload requires only `electron`.
- Live Electron run, driven over the DevTools protocol:
  - `window.p2` and `window.desktop` are exposed and `require` is absent.
  - Clicking a card played the preview through P2: Pause shown, 0:02 of 0:30.
  - The Queue panel listed 8 P2 queue items.
  - After a restart, P2 restored the paused session (track and position).
  - Existing local playlists were migrated to UUID track IDs, and "all time" still lists its 8 songs.
  - The Spotify import page previewed a synthetic export ZIP: 2 playlists, 1 liked song, 5 tracks, 1 duplicate kept, 1 episode skipped, 1 saved album not imported. A decoy account file was ignored.
  - Confirming without a cloud session opened the sign-in dialog.
  - No page exceptions and no CSP violations were logged.

Blocked or not verified:

- **Cloud round-trip is blocked:** Docker and the Supabase CLI are not installed on this machine. Sign-in, cloud playlist listing, add-to-cloud and applying an import have not run against a database. They are only typechecked against P3's adapter.
- `npm` is not on PATH here. The `npm run check` steps were run directly with the bundled Node 24.22.1.
- This shell inherits `ELECTRON_RUN_AS_NODE=1` from VS Code, which stops Electron from starting. `launch.ps1` now clears it.
- Not verified: local-file playback, downloaded-artifact playback, OS media keys, DPI variants.


## Context menus pass

2026-10-31. Live Electron checks of the track/playlist menus and submenu keyboard path passed; 53 unit tests passed. Details and unverified cases in [23-context-menus.md](23-context-menus.md#verification).


## P2 desktop playback pass

2026-10-31, after merge `41d60ee`. Setup: `p2/setup.ps1` (venv with yt-dlp 2026.10.26, yt-dlp-ejs 0.8.0, ytmusicapi 1.12.1) and FFmpeg 9.0.2 via `winget install Gyan.FFmpeg`. `launch.ps1` now puts the Node runtime and a fresh machine and user PATH on Electron's PATH, because the worker runs `yt-dlp --js-runtimes node` and `ffprobe`.

Passed:

- The P2 resolver, called directly, matched "The Great Pumpkin Waltz" to a YouTube Music video in about 7 seconds and returned an `audio/mp4` stream.
- Download: `downloadTrack` completed in 13 seconds on the first attempt, producing a 2.5 MB `audio/mp4` artifact that passed FFprobe. The "Download complete" toast appeared.
- The downloaded track played full-length in the app (0:01 → 0:05 of 2:36).
- Remove from queue and Clear queue work through `removeUpcoming`.

Fixed: queue items had no `durationMs`, so P2's adapter assumed 180000 ms and P4's matcher rejected real tracks with `NO_MATCH`. `itemFor` now passes the catalog duration.

Open:

- **A track that is not downloaded resolves but does not play.** "End Game" got a match and a 4:05 duration, then the audio element reported "no supported source was found." Investigating the stream URL further was blocked by the session's safety policy and not pursued. P2 should check whether the resolved URL can be played directly by Chromium.
- Playback errors are still raw IPC text ("Error invoking remote method 'p2:resolve-stream': …").


All errors from these passes, with exact messages and status, are in [24-person-1-error-log.md](24-person-1-error-log.md).
