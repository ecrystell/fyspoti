# Fyspoti

Windows music application built by a four-person team. Implemented foundations include
Person 3's secure cloud playlists, Person 2's playback/download module, and Person 4's
provider spike and draft catalog contracts. Full application integration is in progress.

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

Read local sign-in codes at `http://127.0.0.1:54324`. Browser development (`npm run dev`) keeps the separate localStorage prototype. Desktop cloud accounts start empty; prototype data is not imported. The UI uses online metadata/artwork and preview audio; full-track playback, downloads and offline synchronization remain separate work. Hosted email is deferred.

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
