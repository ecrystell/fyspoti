# Person 3 — Part 1 implementation and handoff

## Scope and sequencing

1. **Secure cloud foundation (this slice):** authenticated, private playlists and
   items; persistence proof; database-enforced account isolation.
2. **Accounts/core library:** desktop authentication/recovery, profiles, likes,
   saves, playlist edits/deletes and reordering.
3. **Offline/sync:** account-separated SQLite cache, outbox, mutation IDs, server
   revisions, conflicts and deletion tombstones.
4. **Organization/tools:** folders, pins, filtering/sorting, covers, visibility,
   profile listing, recovery and import/export.
5. **Personal data/release:** history/privacy, preferences, session controls,
   export/deletion and packaged-installation checks.

Part 1 proves cloud persistence. It does not implement offline or cross-device change
reconciliation. All playlists are private; no editing or deletion API is exposed.

## Local setup

Prerequisites: Node 24, npm 11, Supabase CLI **2.118.0**, and Docker Desktop with its
Linux engine running. Run from the repository root:

```powershell
npm ci
npm run check
npm run cloud:start
npm run cloud:reset
npm run test:integration
npm run cloud:advisors
```

Initial startup downloads container images. Configuration lives under
`services/cloud/supabase`. The CLI work directory is `services/cloud`, not the
`supabase` subdirectory. The local project identifier is `fyspoti-p3`.

For a lighter local stack, use this instead of `cloud:start`:

```powershell
supabase start --workdir services/cloud --exclude studio,realtime,storage-api,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor
```

Only the database, Auth, gateway and REST API are needed by these tests. Upstream
schema initialization may still download additional service images.

`test:integration` reads local CLI status into process memory. It never prints or
writes API keys to disk. No `.env` file is needed locally. Tests use two ordinary
email/password sessions and a fresh third client for account A. The privileged
fixture client only creates test users and deletes those exact users afterwards.

## Contracts and consumer usage

Contracts are in `packages/contracts`; the adapter is in `packages/library`.

```ts
import { createLibrary, createMemoryClient, signInWithPassword } from '@fyspoti/library';

const client = createMemoryClient(url, publishableKey);
await signInWithPassword(client, email, password);
const library = createLibrary(client);
const playlist = await library.createPlaylist('My playlist');
await library.addPlaylistItem(playlist.id, {
  trackId: canonicalTrackId,
  orderingKey: 0,
  metadataSnapshot: { title: 'Track title', artistNames: ['Artist'], durationMs: 180000 },
});
const firstPage = await library.listPlaylistItems(playlist.id);
```

- `Playlist`: UUID `id`, UUID `ownerId`, `title`, `visibility: 'private'`, ISO timestamp
  `createdAt`. Ownership comes from verified authentication, never caller input.
- `PlaylistItem`: UUID `id`, `playlistId`, app-owned UUID `trackId`, integer
  `orderingKey`, and metadata snapshot. Each addition gets a distinct item ID.
- M0 callers supply distinct ordering keys from 0 through 2147483647. Keys may have
  gaps. An occupied key returns `CONFLICT`; automatic append and drag reorder are
  Part 2 work. Adding the same track at another position is allowed.
- `createPlaylist(title)`, `listPlaylists(cursor?)`, `getPlaylist(id)`,
  `addPlaylistItem(playlistId, item)`, `listPlaylistItems(playlistId, cursor?)` return
  shared contracts. Missing/hidden playlists return `NOT_FOUND` identically.
- Lists return `{ items, nextCursor }`. Pass a non-null cursor to the same list
  method. Page size defaults to 50 (configurable 1–100). Playlists sort by UUID;
  items sort by manual ordering key. Cursors are versioned, account/list-scoped,
  opaque position tokens, not authorization. Snapshot consistency during concurrent
  changes is not promised in M0.
- Snapshots contain title, artist names and duration only. They are untrusted display
  text; consumers must render escaped text. No audio URLs or download paths are stored.
- Validation: playlist title 1–200 characters; snapshot title and each artist name
  1–500; 1–50 artists; integer duration 0–86400000 ms; UUID identifiers.
- Failures are `LibraryError` with `code` and `retryable`. M0 uses `AUTH_REQUIRED`,
  `UNAVAILABLE`, `RATE_LIMITED`, `CONFLICT`, `FORBIDDEN`, `INVALID_ARGUMENT`, and
  `NOT_FOUND`. Provider error details are not returned to UI consumers.
- Database queries have automatic retries disabled. `retryable` describes a temporary
  failure, not a guarantee that replaying an insert is safe. M0 writes have no mutation
  UUID or idempotency receipt; do not automatically replay uncertain writes. Part 3
  adds those guarantees.
- Test sessions stay in memory, with persistence, refresh timers and URL session
  detection disabled. This is not the production desktop session service.

The database adapter maps snapshot fields to typed columns and keeps provider column
names out of public contracts. Its database types are aligned with the migration;
integration tests verify those mappings against real Postgres/PostgREST.

### Teammate review status

**Pending affected-owner review.** No teammate review is claimed by this implementation.
P1 should review the library interface and display/error states. P4 should review
canonical track UUIDs and snapshot fixtures. P2 should confirm that downloads continue
to reference canonical IDs without adding device-local paths here. These are the M0
contract fixtures for that review, not final catalog/provider assumptions.

## Database authorization

Versioned migrations create only `playlists` and `playlist_items`. RLS protects both.
Authenticated callers have SELECT/INSERT grants, with ownership predicates on each
operation; items inherit access through their parent playlist. Anonymous clients
have no table grants. UPDATE/DELETE are denied even for owners until their later
revision/tombstone contract is implemented. Default grants are explicitly revoked.

Indexes cover owner/list pagination and parent/item ordering. A unique
`(playlist_id, ordering_key)` key prevents ambiguous manual order; no uniqueness
constraint exists on track membership. Track UUIDs deliberately have no catalog FK
until P4 supplies its catalog boundary. Parent/user foreign keys support cleanup.

Migration workflow: use the CLI's `migration new` command to allocate migration
names, iterate against the local database, run advisors, then verify a clean local
reset and the integration suite. Do not edit migrations once shared/applied to hosted
environments; add forward migrations. Part 1 has no existing production data to
migrate. Do not reset a hosted database as a rollback strategy.

## Hosted development proof

Selected development target: `https://okyuofmivxqepnbrkxbz.supabase.co` (provided by
the user), verified in Stockholm (`eu-north-1`). This existing user-selected project
supersedes the original Singapore default for development validation.

Use this dedicated **development** project with email/password authentication enabled.
This repo neither creates a paid project nor selects a production environment.
With access to the development project:

```powershell
supabase login
supabase link --project-ref okyuofmivxqepnbrkxbz --workdir services/cloud
supabase db push --linked --dry-run --workdir services/cloud
supabase db push --linked --workdir services/cloud
Copy-Item .env.example .env.cloud
```

Fill `.env.cloud` locally with the project ref, HTTPS URL, publishable key, and a
secret/service-role key for server-side fixture setup/cleanup. Then run:

```powershell
npm run build
npm run test:cloud
```

The hosted run on 2026-10-31 used the existing CLI login to obtain the development
API keys into the test process environment, then invoked the same Vitest integration
configuration directly. No keys or token values were written to the repository.

The CLI database-login path stalled on this network (TCP port 5432 was unreachable).
Deployment used the official [Management API SQL endpoint](https://supabase.com/docs/reference/api/v1-run-a-query)
over HTTPS, authenticated with the existing CLI credential held in memory. After
confirming an empty public schema and migration history, the unchanged migration and
its CLI-compatible ledger entry were applied in one transaction. Hosted migration
version `20261031033217` matches the local file; future migrations must retain this
history. The temporary deployment helper was removed afterwards.

The harness requires the explicit `hosted` target and a URL matching the supplied
project ref; this is a configuration guard, not automatic proof that a project is
non-production. Use development credentials only. The admin key never enters the
library adapter; do not expose `.env.cloud` to a renderer or bundle it with the app.
The test run deletes only synthetic accounts it created. If interrupted, remove the
`fyspoti-a-<run UUID>@example.test` / `fyspoti-b-<same UUID>@example.test` users from the
development Auth dashboard; their fixture playlists cascade-delete.

Do not mark the cloud milestone complete until this hosted run passes and an affected
owner has reviewed the contracts. Local results are not a substitute.

## Verification record

- Type checking and deterministic API/error/pagination tests: passing (14 tests).
- Clean local migration rebuild: passed using Supabase CLI 2.118.0 / Postgres 17.
- Real local two-account integration: passed (9 tests), including fresh-session
  persistence, duplicate items, pagination, direct API isolation, forged ownership,
  denied update/delete, account switching, and expired/tampered-token rejection.
- Local Supabase security/performance advisors: no issues found.
- Production dependency audit: no known vulnerabilities reported at verification.
- Hosted development run: passed on 2026-10-31 against `okyuofmivxqepnbrkxbz`
  (9 tests). Both playlist tables have RLS enabled. Test fixture cleanup completed.
- Hosted security advisors: no issues found. Performance advisors reported only an
  informational unused-index notice for the new `playlists_owner_id_id_idx`; retain
  this index for ownership queries and pagination.
- Human contract review: pending.

Primary references: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[migrations](https://supabase.com/docs/guides/local-development/database-migrations),
[password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
