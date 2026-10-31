# Third-party notices

Fyspoti's own code is licensed under the [MIT License](LICENSE). This file lists the third-party software it uses and how each is licensed. Collected 2026-10-31 from installed package metadata (`npm ls --omit=dev --all` and the Python environment's distribution metadata).

**Compatibility summary:** every bundled JavaScript dependency is permissive (MIT, ISC, 0BSD) and compatible with MIT. Two GPL components, mutagen and FFmpeg, are **not bundled**. Users install them separately and the app calls them as separate processes. MIT code can be combined with GPL code, so there is no conflict. A future packaged release that **bundles** them must meet GPL terms for that bundle, including offering the corresponding source.

## Bundled into the app (JavaScript)

| Package | Version | License |
| --- | --- | --- |
| react, react-dom, scheduler | 19.3.1, 19.3.1, 0.28.0 | MIT |
| lucide-react | 0.468.0 | ISC |
| @supabase/supabase-js and its auth-js, functions-js, postgrest-js, realtime-js, storage-js | 2.118.0 | MIT |
| @supabase/phoenix | 0.4.5 | MIT |
| iceberg-js | 0.8.1 | MIT |
| zod | 4.6.7 | MIT |
| fflate | 0.8.3 | MIT |
| tslib | 2.8.1 | 0BSD |
| @fyspoti/* workspace packages | 0.x | MIT (this repository) |

## Desktop runtime

| Component | Version | License |
| --- | --- | --- |
| Electron | 45.2.1 | MIT. Bundles Chromium and Node.js under their own licenses; see `node_modules/electron/dist/LICENSE` and `LICENSES.chromium.html` |

## Fonts (bundled, unmodified)

| Font | File | License |
| --- | --- | --- |
| Orbitron, by The Orbitron Project Authors | `src/fonts/Orbitron-Variable.ttf` | SIL Open Font License 1.1 (`src/fonts/Orbitron-OFL.txt`). Reserved Font Name "Orbitron" |
| Exo 2, by The Exo 2 Project Authors | `src/fonts/Exo2-Variable.ttf` | SIL Open Font License 1.1 (`src/fonts/Exo2-OFL.txt`) |

## Python workers (installed by `p2/setup.ps1` or pip, not committed)

| Package | Version | License | Used by |
| --- | --- | --- | --- |
| yt-dlp | 2026.10.26 | Unlicense | P2 stream and download worker |
| yt-dlp-ejs | 0.8.0 | Unlicense AND MIT AND ISC | yt-dlp challenge solver |
| ytmusicapi | 1.12.1 | MIT | P4 catalog worker, P2 source lookup |
| mutagen | 1.47.0 | **GPL-2.0-or-later** | P2 download verification (`p2/worker/worker.py`) |
| requests | 2.34.2 | Apache-2.0 | ytmusicapi |
| urllib3 | 2.8.0 | MIT | requests |
| certifi | 2026.10.23 | MPL-2.0 | requests |
| charset-normalizer | 3.5.2 | MIT | requests |
| idna | 3.20 | BSD-3-Clause | requests |
| truststore | 0.10.5 | MIT | worker TLS |
| spotDL (optional) | 4.6.0 | MIT | optional P2 download adapter |

## External tools (installed by the user)

| Tool | License | Notes |
| --- | --- | --- |
| FFmpeg / FFprobe (for example the Gyan.dev build via `winget install Gyan.FFmpeg`) | **GPL-3.0** for that build (FFmpeg itself is LGPL-2.1+ with optional GPL parts) | Used to verify downloads. Not bundled |
| Python 3 | PSF License | Runs the workers |
| Supabase CLI and Docker | Apache-2.0 / various | Local development of cloud features only |

## Development only (not shipped)

TypeScript, Vite, Vitest, Playwright (Apache-2.0), esbuild and @types/* are build and test tools. They are not part of the app bundle.

## Content and services

The MIT License covers this code only. It grants no rights to any music, artwork or metadata the app displays or plays. Catalog metadata and artwork come from Apple's iTunes Search API and YouTube Music, and audio comes from YouTube. Spotify is a trademark of Spotify AB. Fyspoti is not affiliated with Spotify, and its repository contains no Spotify code or assets.
