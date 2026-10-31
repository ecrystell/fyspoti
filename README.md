# Fyspoti

**A free, open-source (MIT) desktop music player, rebuilt in a clean room after studying how Spotify works. Built in one day for Autonomous SG 2026 (NUS Hackers).**

## Hackathon submission

### The target: Spotify Premium

| | Spotify Premium, Singapore | Source |
| --- | --- | --- |
| Individual | **S$11.98 / month** (S$143.76 / year) | [spotify.com/sg-en/premium](https://www.spotify.com/sg-en/premium/), checked 31 Oct 2026 |
| Student / Duo / Family | S$6.48 / S$16.98 / S$20.98 per month | same page |
| People using Spotify | **788 million** monthly active users | [Spotify Q3 2026 results](https://newsroom.spotify.com/2026-10-22/spotify-q3-2026-earnings/), 22 Oct 2026 ([SEC 6-K](https://www.sec.gov/Archives/edgar/data/0001639920/000162828026066889/spot-20260930x6xk.htm)) |
| People paying for Premium | **306 million** subscribers | same release |

The same page lists what Premium adds over the free tier: "Ad-free music listening", "Download to listen offline", "Play songs in any order", "Lossless audio quality", "Listen with friends in real time" and "Organise listening queue". Fyspoti offers the first three, and a queue, at no cost.

### Before / after cost, per user per month

| | Spotify Premium Individual | Fyspoti |
| --- | --- | --- |
| Price to the listener | S$11.98 | **S$0**: free software, MIT licensed |
| Playback, search, downloads | Included | Runs on your own computer, with no API keys or tokens to pay for |
| Cloud library sync (accounts, playlists, likes) | Included | [Supabase](https://supabase.com/pricing) Free plan: **US$0** for up to 50,000 monthly active users and a 500 MB database. Above that, Pro is US$25/month for 100,000 MAU, about **US$0.00025 per user per month** |
| **Total** | **S$11.98** | **S$0**, or about US$0.00025 at 100k users |

Supabase prices are in USD from their pricing page, checked 31 Oct 2026. Free projects pause after a week of inactivity.

### What we uncovered (and how we know)

1. **How the Spotify desktop app is built.** The Windows Store app ships its UI as a ZIP-packaged webpack single-page app (`Apps/xpui.spa`). We analyzed it statically with [REA](docs/18-spotify-rea-investigation.md), reading only and never executing it. Findings:
   - Route chunks (library, playlist, dialogs) are readable JavaScript and CSS. The shared core module table (`__webpack_modules__`), which holds the track context menu, is not on disk as text. It is injected from a compressed V8 startup snapshot.
   - We recovered the design-token scale (spacing, radii, row heights), the submenu geometry (a filter row, one fixed row, then a list capped at 50vh) and the playlist-menu composition order. Evidence IDs, hashes and limits are in [docs 18](docs/18-spotify-rea-investigation.md), [20](docs/20-ui-components-and-motion.md) and [23](docs/23-context-menus.md).
   - Nothing was copied. Reference files stay in a gitignored folder, and Fyspoti uses its own code, its own synthwave design and OFL fonts ([doc 25](docs/25-person-1-synthwave-theme.md)).
2. **Spotify's "Download your data" export.** Only `Playlist*.json` and `YourLibrary.json` matter, and older exports have no track URIs. We tested this on 15 real public samples (41 playlists, 1,764 tracks, 0 unreadable rows). The importer never decompresses the account, email or payment files in the ZIP ([doc 18](docs/18-spotify-import.md)).
3. **Where a free player can get music.** We measured providers ([doc 16](docs/16-provider-spike.md), [capability matrix](docs/17-provider-capability-matrix.md)):
   - YouTube Music search found 20 of 20 test recordings, with a median of 1.0 s.
   - MusicBrainz is good for identity but poor for search ranking.
   - Our recording matcher got 50 of 51 labelled cases right with 0 false accepts ([doc 22](docs/22-catalog-core.md)).

### What Fyspoti does

- **Search and browse:** real catalog search, plus album and artist pages.
- **Playback:** full-track streaming with queue, shuffle, repeat, seek and sleep timer.
- **Library:** playlists, likes and an "Add to playlist" submenu.
- **Spotify import:** bring your playlists and Liked Songs in from Spotify's own data export.
- **Offline:** downloads that play without a connection, plus local files.
- **Accounts:** email-code sign-in with cloud-synced private playlists.

### Licence and honesty notes

- Code: [MIT](LICENSE). Every dependency is listed with its licence in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). All bundled ones are permissive. GPL tools (FFmpeg, mutagen) are installed separately and not bundled.

### Run the demo (Windows)

```powershell
npm ci                        # Node 24
npm run setup:desktop         # downloads the Electron runtime
./p2/setup.ps1                # Python environment for streaming and search (yt-dlp, ytmusicapi)
winget install Gyan.FFmpeg    # ffprobe, used to verify downloads (optional)
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1
```

`launch.ps1` builds everything and opens the app. Accounts and cloud sync also need the local Supabase stack (Docker); see below. The browser-only preview is `npm run dev`. Checks run with `npm run check`.

---

Windows music application built by a four-person team. Implemented foundations include
Person 3's secure cloud playlists, Person 2's playback/download module, and Person 4's
provider spike and draft catalog contracts. Full application integration is in progress.

The Electron app uses the pulled P1 synthwave UI and P4 catalog/search updates.
P3's account services and encrypted queues are preserved behind the bridge; the
incoming renderer's personal-library/account controls still need those bindings.
P2 playback uses the scoped service hook. Queues restore paused.
Full-track source failures automatically use an available, labelled preview.
See [unified desktop handoff](docs/23-person-3-unified-playback.md).
The browser demo (`npm run dev`) stays separate; the old desktop prototype switch
has been removed. Import, downloads and local files remain unavailable in account
mode while their ownership is connected; existing device files are untouched.

- [Plans and architecture](docs/README.md)
- [Provider spike](docs/16-provider-spike.md) and [capability matrix](docs/17-provider-capability-matrix.md)
- [Shared contracts](packages/contracts/README.md)
- [Playback and downloads](p2/README.md)

## Desktop frontend

The Electron UI connects local email-code accounts to private cloud playlists, likes and display-name profiles. See [desktop accounts setup](docs/22-person-3-desktop-accounts.md), [frontend features](docs/16-person-1-implementation.md) and [queue/Connect audit](docs/21-queue-connect-menu-audit.md).

After installing dependencies:

```powershell
npm run setup:desktop
npm run cloud:start
npm run build
npm run desktop:local
```

Read local sign-in codes at `http://127.0.0.1:54324`. Desktop cloud accounts start empty; prototype data is not imported. P2's existing full-track source requires its Python setup; preview fallback remains available when the catalog supplies one. P4 catalog integration, downloads and offline synchronization remain separate work. Hosted email is deferred.

## Development

Use Node 24, npm 11, Docker Desktop (Linux containers), and Supabase CLI 2.118.0.
Dependency versions are pinned in `package-lock.json`.

```powershell
npm ci
npm run check
npm run cloud:start
npm run cloud:reset
npm run test:integration
```

`cloud:reset` destroys **this project's local test database**, then applies migrations
and seeds. It never resets a linked cloud project. The integration harness creates
two synthetic Auth users and cleans up only those users and their playlists.

`npm run check` needs no Docker, network service, account or secret after installation.
Integration tests require running local Supabase and fail if unavailable; they do not
silently skip. `npm run cloud:stop` stops the local stack when finished.

See [Person 3 setup and handoff](docs/16-person-3-foundation.md) for the API contract,
hosted development validation, ownership boundaries, and acceptance status.
See [Part 2A](docs/18-person-3-connected-library.md) for likes, revision-safe editing,
account-scoped state and the queue connection to P2. `npm run test:migrations`
checks upgrading populated Part 1 data in a disposable local database.

## Packages

- `@fyspoti/contracts`: playlist types, catalog schemas, pagination and library/catalog interfaces.
- `@fyspoti/library`: Supabase adapter and in-memory authentication helper.
- `@fyspoti/accounts`: main-process email-code authentication, encrypted sessions and profile service.
- `services/cloud`: Supabase configuration, migrations and fixture seed policy.

`npm run build` builds both workspace packages and the desktop frontend. Use `npm run build:packages` or `npm run build:frontend` to build either independently. Run `npm run build:packages` before consuming workspace packages. Each package exports compiled
JavaScript and TypeScript declarations. `npm run typecheck` builds them and checks the
test harness. `npm test` runs deterministic API/error/pagination tests.

## License

The code and documentation in this repository are released under the [MIT License](LICENSE). Anyone may use and reuse them under those terms.

The license covers only what this project wrote. It gives no rights to music, lyrics, artwork or data from third-party services, and those stay subject to their owners' terms. Third-party dependencies keep their own licenses.

fyspoti is an independent project. It is not affiliated with or endorsed by Spotify, YouTube or any music provider. Anyone running it is responsible for how they use those services.
