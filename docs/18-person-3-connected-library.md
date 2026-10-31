# Person 3 — Part 2A connected core library

## Delivered boundary

The library now accepts P4's canonical string track IDs unchanged, persists likes
and private playlists, protects edits with revisions and operation receipts, and
prepares queues for P2's existing `Player`. P1 can consume account-scoped observable
state without waiting for a desktop shell. This slice has no renderer UI.

The executable acceptance journey uses P4's `createMockCatalog`, two real Supabase
accounts, an independent client after reload, and P2's real `Player` with a fake audio
engine and fixture resolver. It does not demonstrate live-provider streaming.

## Consumer API

Build the workspace before importing `@fyspoti/library`:

```ts
import { createLibraryApi, playPlaylist } from '@fyspoti/library';

// client uses a publishable key and an ordinary authenticated user's session.
const api = createLibraryApi(client, { accountId, pageSize: 50 });
const created = await api.createPlaylist('Favorites', crypto.randomUUID());
if (!created.ok) return showError(created.error);
const edit = { mutationId: crypto.randomUUID(), expectedRevision: created.value.revision };
const appended = await api.appendTrack(created.value.id, catalogTrack, edit);
if (!appended.ok) return showError(appended.error);
await playPlaylist(api, player, created.value.id, appended.value.item.id);
```

Every `LibraryApi` method resolves to shared `Result<T>` data. Errors use the shared
`AppError` schema, including `INVALID_ARGUMENT`, `NOT_FOUND` and `FORBIDDEN`. Hidden
and missing playlists both produce `NOT_FOUND`. Bind `accountId` in account-owned
consumers; API requests verify the session and suppress responses after account changes.

| Operation | Arguments | Successful value |
| --- | --- | --- |
| `createPlaylist` | title, mutation UUID | Playlist with revision |
| `listPlaylists` | optional cursor | Page of playlists |
| `getPlaylist` | playlist UUID | Playlist with revision |
| `listPlaylistItems` | playlist UUID, optional cursor | Page of items |
| `setTrackLiked` | validated catalog Track, explicit boolean, mutation UUID | TrackLike |
| `getTrackLike` | canonical track ID | TrackLike; absent means false, revision 0, null snapshot/ID |
| `listLikedTracks` | optional cursor | Page containing only liked tracks |
| `appendTrack` | playlist UUID, Track, mutation context | Updated playlist and new item |
| `renamePlaylist` | playlist UUID, title, mutation context | Updated playlist |
| `removePlaylistItem` | playlist UUID, item UUID, mutation context | Updated playlist |
| `reorderPlaylistItems` | playlist UUID, all active item UUIDs in desired order, mutation context | Updated playlist |
| `deletePlaylist` | playlist UUID, mutation context | Deleted playlist ID and accepted revision |

Track IDs are bounded opaque strings, including `track-harbor-studio` and existing
UUID strings. Cloud persistence rejects URLs, file paths, `local:`, `p2-media:` and
Spotify URIs as identity. Track metadata is validated using P4's `Track` schema;
the stored snapshot contains title, artist names and duration, with Part 1 bounds.
Reading these snapshots needs no catalog request. Cloud access still needs a network.

The five-method exception-based `createLibrary` interface remains available. It
now routes writes through RPC and returns playlist revisions too. Its explicit
ordering-key method is retained for compatibility; new consumers should use
`appendTrack`. Legacy operations generate internal UUIDs and must not be blindly
repeated after an uncertain response.

## Mutation and authorization rules

- Preserve a mutation UUID and exact payload until its outcome is known. Repeating
  that request returns the originally accepted response without applying it again,
  even if later operations changed the collection. Changing an accepted request's
  contents under the same UUID produces `CONFLICT`.
- Receipts are scoped to the authenticated account. The RPC also checks the expected
  account captured by the service, preventing a session change from redirecting an
  in-flight write to the next account.
- Playlist writes lock the parent, check the supplied revision, and increment it
  once on success. Concurrent stale operations fail explicitly. Appends assign order
  on the server; intentional duplicate tracks retain separate item UUIDs.
- Reorder requires exactly the current active item IDs. Its deferrable unique-order
  constraint permits atomic swaps without partial updates. Removal addresses one
  item UUID and retains its deletion tombstone in the private schema.
- Likes store explicit true/false state, unique per account and canonical track ID.
  Unlike retains its row. Different accepted operations are ordered by the server;
  replaying an older like cannot undo a later unlike.
- Deleting a playlist sets `deleted_at`, increments its revision and retains its
  metadata/items and receipt. RLS hides it and its items from normal reads.
- `library_private` contains receipts, item tombstones and the mutation implementation.
  The exposed `library_mutate` wrapper is invoker-security; its private definer
  explicitly checks authentication/ownership and has an empty search path. Direct
  authenticated table INSERT/UPDATE/DELETE grants are revoked. No admin key belongs
  in the library or a renderer.
- An account-level advisory lock serializes receipt lookup/write and likes; playlist
  operations additionally lock their parent. This intentionally favors simple
  correctness over maximum same-account throughput for this milestone.

Retain receipts, unlike state and tombstones until Part 3 defines retention and
change-feed semantics. There is no offline queue, automatic conflict overwrite,
background mutation replay, recovery API or public visibility in Part 2A.

## P1 state and P2 queue handoff

`createLibraryController(client)` subscribes to Supabase auth changes. Its controller
exposes `snapshot`, `subscribe`, `load(playlistId?)`, `loadMore(kind)`, and `run(action)`.
Load explicitly after authentication; auth callbacks only clear/rebind state and do
not issue nested auth calls. Call `dispose` when the owner is removed.

Snapshots contain account ID, phase (`loading`, `ready`, `mutation-pending`, `conflict`
or `error`), playlist/like pages, selected playlist/items, cursors, and failed-action
details. A null account represents signed out. Snapshots are copied; logout/account
changes clear state synchronously, and generation checks discard late requests.

After a stale edit, the controller refreshes state and preserves the failed action.
`retryConflict()` explicitly retries it with a new UUID and refreshed revision.
`retryUncertain()` explicitly repeats a temporary/uncertain failure using its original
UUID and revision, including deletes already hidden by refreshed reads. Neither runs
automatically. One controller action is pending at a time.

`preparePlaylistQueue` reads all pages between two revision checks. It preserves
manual order, duplicate track IDs and distinct item IDs, joins artist names for P2,
and rejects a changing collection or more than 10000 items. `playPlaylist` only
replaces P2's queue after preparation succeeds and validates the optional start item.
Later playlist edits never mutate an active queue. Snapshot display metadata and
identity are passed to P2; streams, credentials and artifact paths are not cloud data.

The only change inside `p2/` is an explicit `event.type === 'error'` branch guard so
TypeScript 7 can narrow its grouped event union during connected-test type checking.
Test compilation retains P2's existing optional-property convention; production
P3 packages still compile with their original strict settings.

## Checks and rollout

```powershell
npm run check
node --experimental-strip-types --test p2/tests/*.test.ts
npm run test:migrations
npm run cloud:reset
npm run test:integration
npm run cloud:advisors
```

The upgrade check creates a uniquely named disposable database inside the local
`supabase_db_fyspoti-p3` container, applies the unchanged Part 1 migration, inserts
synthetic Part 1 data, then applies Part 2A and verifies preserved IDs/snapshots and
deletion tombstones. It drops only that generated database. `cloud:reset` remains
local-only and separately verifies clean installation of both migrations.

Apply the forward migration `20261031043416_connected_core_library.sql` only after
local checks, preserving the existing `20261031033217` ledger entry. Existing client
code must be upgraded to the RPC adapter when direct writes are revoked. Repair
deployment failures with forward migrations; do not re-enable bypassing table grants
or reset hosted data. The hosted target remains `okyuofmivxqepnbrkxbz`, Stockholm.

Hosted validation runs the same integration configuration with explicit project
matching, normal test-user sessions, privileged fixture creation/cleanup only, and
keys held in the test process environment. See Part 1's handoff for access setup.

Verification completed on 2026-10-31:

- Type checks and 26 library/API/controller/queue unit tests passed.
- All 17 P4 catalog contract tests and six P2 core tests passed.
- Populated Part 1 upgrade check passed, preserving IDs and snapshots and verifying
  item tombstones and revoked raw INSERT access.
- Clean database rebuild from both migration files passed; all 16 local integration
  tests passed, including the original nine Part 1 isolation checks.
- The same 16 integration tests passed against the hosted development project.
  Both migration versions are present in its ledger. The existing HTTPS Management
  API deployment route recorded the forward migration atomically with its ledger
  entry; project keys stayed in the test process environment.
- Hosted cleanup was verified: zero synthetic users, playlists, items, likes,
  receipts or tombstones remained. Direct authenticated playlist INSERT and like
  UPDATE privileges were verified false. The temporary HTTPS helper was removed.
- Local advisors reported no issues. Hosted advisors reported informational notices
  for private deny-all tables with RLS/no client policies and unused new indexes.
  These are deliberate authorization/index choices, not reasons to grant clients
  access or remove ownership/FK indexes.
- Hosted Auth advisors also reported leaked-password protection disabled. This is
  a project Auth setting for Part 2B review; this migration does not change it.
- Production dependency audit reported no known vulnerabilities.

## Affected-owner review request

Review requests are prepared here for the team; no external messages or teammate
approvals are claimed. **All sign-offs remain pending.**

- **P1:** review `LibraryApi` results, controller phases/pagination, conflict versus
  uncertain retry controls, and signed-out/late-response behavior.
- **P4:** review unchanged opaque catalog IDs, snapshot mapping, common error codes,
  and the absence of a second catalog database.
- **P2:** review structural queue compatibility, duplicate/start-item behavior,
  10000-item limit and the one-line event guard. Source resolution/download ownership
  is unchanged. P2's current global player persistence will need account scoping at
  the production-auth integration milestone; this slice does not claim that isolation.

Next: Part 2B production authentication/recovery, secure sessions, profiles, and saved
albums/artists/playlists. Full SQLite/offline sync follows in Part 3. P2/P4's production
stream resolver and P1's shell remain independent integration dependencies.
