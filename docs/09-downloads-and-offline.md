# Downloads and offline plan

Owner: P2. Required at launch. P3 owns library associations; P4 supplies recording identity; P1 supplies presentation.

## Reference and boundary

Study [spotDL's public entry API](https://github.com/spotDL/spotify-downloader/blob/master/spotdl/__init__.py) and [download coordinator](https://github.com/spotDL/spotify-downloader/blob/master/spotdl/download/downloader.py). Wrap a pinned version behind our own job protocol. Confirm the supported public API and progress hooks for that version; do not depend on undocumented private hooks without an adapter test. Provider access and permission are separate from code reuse.

## Pipeline

1. Expand requested album/playlist into a track snapshot; deduplicate transfer work while retaining all library references.
2. Resolve the canonical recording to candidates. Use P4 evidence to reject wrong live/remix/cover versions; allow manual source correction.
3. Create a persisted job: queued -> resolving -> transferring -> processing -> verifying -> complete. Additional states: retry-wait, failed and cancelled. Pause/resume is optional unless verified with the chosen worker.
4. Run a packaged Python worker under the desktop process. Send versioned JSON requests; emit structured progress/results on stdout and diagnostics on stderr. Request IDs correlate jobs; a startup handshake reports versions/capabilities.
5. Transfer into a job-owned temporary directory. Bound concurrency, timeout and retries. Cancel must terminate the job's subprocess tree and clean its temporary files safely.
6. Convert only when requested/necessary, attach authorized metadata/artwork and verify decodability, duration and actual output format.
7. Atomically move the complete file into managed storage, then commit its artifact record. On crash, reconcile incomplete jobs and orphaned files without declaring corrupt files complete.
8. Prefer the artifact for playback. Missing/corrupt artifacts return to an explainable recoverable state.

## Storage rules

Store files under the application's selected data directory; sanitize Windows filenames, reserved names and path lengths. Enforce storage quota and free-space checks before transfer and conversion. Keep source IDs, codec, bytes, verification result and local path device-local. Sync download preferences if desired, never local paths or downloaded audio by default.

An artifact may serve several playlists. Removing one playlist's download reference must not delete a file another downloaded collection still needs. Removing a library item and removing a local artifact are distinct operations. Treat playlist changes as explicit download reconciliation; do not directly expose destructive upstream directory-sync behavior.

## Packaging

Inventory Python, spotDL, extractor dependencies, FFmpeg and any optional runtime requirements at a pinned revision. Package and verify required binaries, notices and supported architectures. Spawn executable plus argument array without a shell. No secret credentials in logs, no UI-thread conversion, no required global Python/FFmpeg installation. Upstream updates need a packaged smoke test.

## Launch UX

Track/album/playlist download actions, progress, cancel, retry, available-offline badge, downloaded library filter, storage usage and remove-download action. Going offline keeps saved metadata available and clearly distinguishes downloaded from unavailable items.

## Later

Offline Backup from permitted cached media, offline lyrics, additional export formats and user-controlled directory synchronization. These are separate from launch downloads.

## Acceptance

Run download -> terminate app -> restart -> reconcile; cancellation during conversion; disk-full; Unicode filenames; duplicate jobs; changed playlist; worker crash; expired source; missing metadata; and restart with networking disabled. A clean Windows machine must play a completed download without developer tools.
