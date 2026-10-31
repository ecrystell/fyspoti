# Person 2 module

This folder implements the person 2 playback and device-local download module from `docs/04`, `docs/08` and `docs/09`. The Electron desktop shell now uses it; the browser-only Vite view keeps preview playback.

## Included

- `Player`: generation-safe playback, queue, shuffle/history, repeat, seek, volume, sleep timer and deduplicated listening sessions.
- `BrowserAudio`: renderer-side HTML audio engine; `bindMediaSession` exposes operating-system media commands.
- `OfflineFirstResolver`: chooses a verified local artifact before asking the catalog adapter for a fresh stream.
- `DownloadManager`: persisted single-worker queue, progress, cancel/retry, quota checks, crash recovery and device-local artifacts.
- `worker/worker.py`: JSON-line protocol, direct permitted-audio transfer or explicit spotDL track URL, FFprobe verification and job-owned temporary files.
- `electron-main.ts` and `electron-preload.ts`: narrow download/local-file IPC and a managed media URL scheme. `renderer-player.ts` creates the player for P1's renderer and restores a paused session.
- `youtube-source.ts` and `worker/youtube_source.py`: temporary YouTube Music candidate lookup and yt-dlp stream resolution until P4 supplies a live accepted-candidate service.

The Electron main process calls `registerP2MediaScheme()` before `app.whenReady()` and `installP2Desktop(window, workerPaths)` after it. The renderer calls `createRendererPlayer(window.p2, catalogAdapter, emitListening)`. P3 listening-event storage remains an integration task.

Run `./p2/setup.ps1` once on Windows to create the ignored `p2/.venv` and install the pinned YouTube dependencies. Then run `./launch.ps1`. Use the App menu to add local audio files, or a collection's Download button to queue online tracks. The YouTube route is the unofficial provider exception in `docs/16-provider-spike.md`; it uses no account credentials.

`WorkerPaths` requires explicit executable paths and never assumes global tools. A Windows release still needs to bundle Python, a JavaScript runtime, FFprobe/FFmpeg where required, and test on a clean machine. P4's final candidate service, P3 listening-history storage, and production packaging remain integration work.

`worker/requirements.txt` pins the spotDL adapter version used by this module. The final package still needs pinned FFmpeg and Python builds and their license notices.

Run `npm run check` from the repository root to type check the desktop and P2 code and run deterministic tests. Run `node --test p2/tests/*.test.ts` for P2 tests alone.
