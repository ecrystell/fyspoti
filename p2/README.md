# Person 2 module

This folder implements the person 2 playback and device-local download module from `docs/04`, `docs/08` and `docs/09`. It is designed to plug into the desktop app when the shared Electron shell and catalog contracts exist.

## Included

- `Player`: generation-safe playback, queue, shuffle/history, repeat, seek, volume, sleep timer and deduplicated listening sessions.
- `BrowserAudio`: renderer-side HTML audio engine; `bindMediaSession` exposes operating-system media commands.
- `OfflineFirstResolver`: chooses a verified local artifact before asking the catalog adapter for a fresh stream.
- `DownloadManager`: persisted single-worker queue, progress, cancel/retry, quota checks, crash recovery and device-local artifacts.
- `worker/worker.py`: JSON-line protocol, direct permitted-audio transfer or explicit spotDL track URL, FFprobe verification and job-owned temporary files.
- `electron-main.ts` and `electron-preload.ts`: narrow download/local-file IPC and a managed media URL scheme. `renderer-player.ts` creates the player for P1's renderer and restores a paused session.

The app supplies `CatalogSourceAdapter`, permitted download requests, P3 listening-event storage and P1 controls. In Electron main, call `registerP2MediaScheme()` before `app.whenReady()` and `installP2Desktop(window, workerPaths)` after it. In the renderer, call `createRendererPlayer(window.p2, catalogAdapter, emitListening)`. The host shell must set context isolation, sandboxing and a restrictive CSP.

`WorkerPaths` requires explicit executable paths and never assumes global tools. A Windows release must bundle Python, spotDL, FFmpeg and FFprobe, then test the installed app on a clean machine. The spotDL CLI path is an optional adapter requiring source and content permission. The implementation has no built-in Spotify or other catalog credentials. Source access, shared contracts, UI controls, actual worker packaging and a clean-machine test remain integration work.

`worker/requirements.txt` pins the spotDL adapter version used by this module. The final package still needs pinned FFmpeg and Python builds and their license notices.

Run `node --experimental-strip-types --test tests/*.test.ts` from this folder to check the pure TypeScript core. `pnpm install` followed by `pnpm check` adds static type checking when dependencies can be fetched.
