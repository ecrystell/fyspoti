# Upstream reference map

Research date: 2026-10-31. Branch links move. Pin exact commit hashes and dependency versions during implementation; no repository snapshot or app code was copied into this workspace.

## Spotube: app architecture reference

[Repository](https://github.com/team-spotube/spotube), [README](https://github.com/team-spotube/spotube/blob/master/README.md), [settings.gradle.kts](https://github.com/team-spotube/spotube/blob/master/settings.gradle.kts).

The inspected current root uses Compose Multiplatform and separates `composeApp`, `plugin_interfaces` and a JS plugin example. It describes separate metadata, playlist and audio-source plugins. Earlier descriptions of a Flutter app are not the architecture baseline for this plan. Use the separation of provider capabilities and playback concerns as design input. Do not retain Spotube's screen layout.

Inspection next: trace one track from provider result through source resolution into playback, then examine cancellation, queue state and lyrics synchronization in a pinned checkout. Root/module structure was inspected; internal Kotlin implementations were not audited in this task.

The current repository declares AGPL-3.0-or-later. If importing or adapting its code, assess applicable source-distribution/network obligations and preserve notices. Architectural reference and original implementation are the default for the new app; do not assume copying code is license-neutral.

## spotDL: downloader implementation reference

[Repository](https://github.com/spotDL/spotify-downloader), [entry API](https://github.com/spotDL/spotify-downloader/blob/master/spotdl/__init__.py), [downloader](https://github.com/spotDL/spotify-downloader/blob/master/spotdl/download/downloader.py), [package tree](https://github.com/spotDL/spotify-downloader/tree/master/spotdl).

The inspected API separates search and downloads. The downloader coordinates audio providers, concurrency, conversion, metadata embedding and progress. The project finds corresponding audio elsewhere using Spotify information; it is not a Spotify-audio exporter. Use it behind an app-owned download adapter rather than coupling UI to CLI output. Its README identifies FFmpeg and yt-dlp-related runtime requirements; inspect the pinned release before bundling Python, FFmpeg or optional runtimes. Never install a floating runtime silently on first launch.

The repository declares MIT licensing. Keep required notices for reused code and inventory transitive/binary licenses independently. A software license is not a music-content license or provider-access permission.

## Spotify: UI and behavior reference

Use the actual current Windows desktop app for the visual baseline. Capture app version, date, window size, DPI and account/market conditions. The initial research only established documented features, not pixel measurements.

Useful official behavior references: [Library](https://support.spotify.com/uk/article/your-library/), [transitions](https://support.spotify.com/sg-en/article/tracks-transitions/), [lyrics updates](https://newsroom.spotify.com/2026-02-04/lyric-translations-offline-previews/), [2026 desktop/mobile controls](https://newsroom.spotify.com/2026-05-28/playlist-folders-mobile-queue-controls-updates/).

## Reference-use procedure

1. Record URL, exact revision, files examined and finding in an implementation decision note.
2. Separate observed upstream behavior from a proposed app design and an unverified assumption.
3. Validate provider access with rights-cleared fixtures and current official provider terms before committing the provider to launch.
4. Test account access, rate limits, source matching and packaged operation. README feature claims are not proof that an integration works today.
5. Preserve own app name, assets and attribution while matching the requested desktop layout and interactions.
