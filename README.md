# Fyspoti

Windows music application built by a four-person team. The Electron desktop shell now
uses Person 2's player and download bridge. Person 3's cloud playlists and Person 4's
catalog contracts remain separate integration work.

- [Plans and architecture](docs/README.md)
- [Provider spike](docs/16-provider-spike.md) and [capability matrix](docs/17-provider-capability-matrix.md)
- [Shared contracts](packages/contracts/README.md)
- [Playback and downloads](p2/README.md)

## Desktop frontend

Person 1's React/Electron UI is implemented. See [frontend features](docs/16-person-1-implementation.md) and [queue/Connect audit](docs/21-queue-connect-menu-audit.md). The desktop player is connected to Person 2's module.

After installing dependencies:

```powershell
npm run setup:desktop
npm run build
./p2/setup.ps1
npm run desktop
```

Windows shortcut: run `.\launch.ps1`. It finds Node on PATH or the existing Codex runtime. Browser development: `npm run dev` keeps the preview player. The desktop uses P2 for full-track playback and downloads through the provisional YouTube route recorded in [the provider spike](docs/16-provider-spike.md). The Python setup is required for that route; local files work through the same player. Cloud synchronization is still separate work.

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
- `services/cloud`: Supabase configuration, migrations and fixture seed policy.

`npm run build` builds both workspace packages and the desktop frontend. Use `npm run build:packages` or `npm run build:frontend` to build either independently. Run `npm run build:packages` before consuming workspace packages. Each package exports compiled
JavaScript and TypeScript declarations. `npm run typecheck` builds them and checks the
test harness. `npm test` runs deterministic API/error/pagination tests.

## License

The code and documentation in this repository are released under the [MIT License](LICENSE). Anyone may use and reuse them under those terms.

The license covers only what this project wrote. It gives no rights to music, lyrics, artwork or data from third-party services, and those stay subject to their owners' terms. Third-party dependencies keep their own licenses.

fyspoti is an independent project. It is not affiliated with or endorsed by Spotify, YouTube or any music provider. Anyone running it is responsible for how they use those services.
