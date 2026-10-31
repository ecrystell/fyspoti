# Fyspoti

Windows music application. The first implemented slice is Person 3's secure cloud
playlist foundation. The Electron UI, playback, catalog adapters and full library
synchronization are future slices described in [docs](docs/README.md).

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

## Packages

- `@fyspoti/contracts`: provider-independent playlist types and library interface.
- `@fyspoti/library`: Supabase adapter and in-memory authentication helper.
- `services/cloud`: Supabase configuration, migrations and fixture seed policy.

Run `npm run build` before consuming workspace packages. Each package exports compiled
JavaScript and TypeScript declarations. `npm run typecheck` builds them and checks the
test harness. `npm test` runs deterministic API/error/pagination tests.
