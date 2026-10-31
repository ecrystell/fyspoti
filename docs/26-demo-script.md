# Live demo script (under 3 minutes)

Written for whoever presents. Every step below was run on the current build on 31 Oct 2026, timed in a fresh profile. Rubric weights: coolness 25%, cost reduction 25%, cost of the status quo 20%. The pitch numbers are in the [README](../README.md#hackathon-submission).

## Setup (before going on stage)

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1` and wait for the window.
2. **Pre-warm the songs you will play.** Play each one once for a second, then pause. A first play takes about 10 s to resolve the stream. A repeat play takes about 1.6 s, because the source is cached.
   - Search `the weeknd blinding lights`, and play the first result, "Blinding Lights — The Weeknd".
   - Search `daft punk get lucky`, and play the first result.
3. Have a Spotify data export ZIP ready to choose. A real "Account data" export works, as does any test ZIP containing `Playlist1.json`.
4. Close the search box and go Home.

Avoid `m83 midnight city`: it failed to start within 30 s in testing.

## Script

| Time | Do | Say |
| --- | --- | --- |
| 0:00–0:20 | Show the Home screen | "Spotify Premium costs S$11.98 a month in Singapore, and 306 million people pay it. Fyspoti is free and MIT-licensed." |
| 0:20–0:50 | Search `the weeknd blinding lights`, then play the first result (pre-warmed, about 1.6 s) | "Full catalog search and full-length tracks, not 30-second previews. That is a Premium feature." |
| 0:50–1:10 | Right-click the song → **Add to playlist ▸** → type in **Find a playlist** → pick one | "We reverse engineered how Spotify's desktop menus are built from its packaged app. Then we rebuilt them in our own code and style." |
| 1:10–1:30 | Click the album name → album page. Click the artist → artist page | "Real album and artist pages from our own catalog service." |
| 1:30–2:05 | App menu → **Import from Spotify** → choose the ZIP. The preview shows counts for playlists, liked songs, tracks, duplicates and skipped podcasts | "We decoded Spotify's own data export. Your playlists come with you. It only opens the playlist files, never your email or payment data." |
| 2:05–2:30 | Open **Queue**, drag a song to reorder, then try **Sleep timer** | "Queue, shuffle, repeat and sleep timer: the Premium playback controls, free." |
| 2:30–2:50 | Back to Home, cost table on a slide | "S$11.98 versus S$0. At 100,000 users the cloud sync costs about US$0.00025 each." |

## Do not demo (not working in this build)

| Feature | State | Why |
| --- | --- | --- |
| Download / offline | The button reports "Device downloads and legacy playback are unavailable in account mode." | P2 and P3 disabled device downloads in account mode. That is their decision; see [P3 handoff](23-person-3-unified-playback.md) |
| Sign in / cloud sync | Our dialog says no cloud library is configured | P1's UI still uses the old P3 adapter. P3's new email-code accounts (`window.desktop.cloud`) are not wired into this UI yet |
| Applying an import | Needs sign-in | Same as above. The preview works |
| Local files | Unavailable in account mode | Same as downloads |

## If something fails on stage

- **A song will not start within about 3 s:** say "first play resolves the stream". Then play the other pre-warmed song.
- **Search shows a notice with Retry:** the catalog worker hit a rate limit or a network failure. Click Retry once, or go straight to the import step.
- **The app will not open:** run the launcher from a fresh PowerShell window. The launcher clears VS Code's `ELECTRON_RUN_AS_NODE`.
