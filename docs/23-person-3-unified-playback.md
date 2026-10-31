# Person 3 — Part 2C: unified account library and playback

P1's original implemented `App` in `src/main.tsx` is the desktop and browser
interface, including its Home/release card, account menu, sidebar views, context
menus, profile/edit dialogs, transport and Queue/Connect panels. Its original
styles and components are retained. P3's `useP1Library` supplies account data;
P2 supplies scoped playback behind that interface. The replacement CloudApp and
DesktopApp layouts are not app entry points or bundled UI. Browser mode retains
its separate local prototype data; desktop mode uses the account library.

## Run and boundaries

Use the [local account setup](22-person-3-desktop-accounts.md). Run
`npm run build` then `npm run desktop:local`. Local email is captured at
`http://127.0.0.1:54324`; no hosted email or database deployment is configured here.

For full-track playback, P2's existing source adapter needs the Python environment
from `p2/setup.ps1` or an explicit `FYSPOTI_PYTHON`. Missing tools/source failures
fall back to an available iTunes preview. The player displays **Preview** and offers
**Retry full track**. Unknown duration is never replaced with a guessed duration;
unsupported metadata goes directly to preview if available. Without either source,
the queue remains available with an error/retry action.

Import, downloads, saved albums/artists, local files, covers, descriptions, pins and
public sharing are deferred in account mode. Download/local-file channels reject
calls, legacy job/artifact stores are never opened, jobs never broadcast, and the
old `p2-media` file protocol is not installed by this host. The standalone P2 host,
its tests and all existing device files remain intact. Listening-history storage,
P4's real catalog/matcher and offline library synchronization are also deferred.

## Data and playback

- Desktop iTunes IDs retain Part 2B's deterministic provider-ID mapping. Existing
  cloud IDs are never rewritten; saved metadata remains readable without catalog
  fetches. P1's older text-derived identity is confined to the browser demo.
- Playlist playback uses the existing complete revision-checked queue snapshot.
  Item IDs become queue IDs, so duplicates stay distinct. Liked Songs fetches all
  its cursor pages before playback. Oversized collections fail at 10,000 items.
- Choosing a track selects its stable queue item inside the complete snapshot.
  Later library mutations do not rewrite that playback snapshot.
- Play/pause, seek, previous/next, volume, shuffle/repeat, sleep timer, enqueue and
  upcoming-order changes call P2 commands. Queue remove/clear remain unavailable;
  the UI does not emulate them in React state.
- Full-track resolution reuses P2's existing JSON-line source worker. Switching
  tracks cancels the prior source process; account changes cancel all pending
  resolutions. URLs remain transient and are never used as cloud identities.
- Preview/full-track mode is recorded per queue entry. Restores are paused and
  resolve a fresh URL only after a play action. Guest playback is memory-only and
  discarded on login; guests never inherit an account queue.

## Public interfaces and trust boundaries

`desktop.cloud` gains `prepareLikedQueue(): Result<LibraryQueueItem[]>`.
It uses the main-process authenticated client and returns typed errors for account
changes, missing metadata, pagination failures and the queue limit.

`desktop.playback` is a narrow `ScopedPlaybackBridge`:

| Method | Result |
| --- | --- |
| `session()` | Current generation, authenticated owner or guest, availability and storage notice |
| `load(generation)` | Current owner's snapshot or null |
| `save(generation, snapshot)` | Accept and serialize the validated snapshot for the current owner |
| `resolve(generation, track)` | P2's ephemeral full-track source or typed failure |
| `subscribe(listener)` | Sanitized session changes |

All request methods return shared `Result<T>`. Sender/frame/application-URL checks
and strict Zod schemas guard IPC. A renderer cannot supply an owner, file path,
arbitrary source URL or unknown payload fields. Retired generations fail, including
after the same account signs in again. The legacy `window.p2` methods remain typed
for standalone consumers but cannot bypass these checks in the account host.

The main process derives the scope from account-service state. Restoring or an
account-service outage blocks restoration. Logout, login and authentication loss
retire the old scope. The renderer immediately unloads audio and removes system
media handlers/metadata on session changes, before initializing another player.

## Encrypted queue format and lifecycle

Each queue uses `userData/accounts/queues/<account UUID>.enc`. The decrypted,
strictly validated envelope is `{version: 1, owner, snapshot}`. A snapshot contains
P2 player state, upcoming item IDs and each entry's `full-track`/`preview` mode.
It contains no resolved/preview URL, token, local path, or persisted player error.
Files larger than 32 MiB and queues over 10,000 entries are rejected.

Queue files use Electron async OS safeStorage, separate from the credential vault.
Writes are serialized and atomically renamed. Ownership is captured when a save
is accepted: it may finish for A after logout, while late requests with A's retired
generation are rejected. B can never choose A's file. Logout removes credentials
but retains A's encrypted queue for A's next verified login. Application exit
flushes accepted saves; restoration always pauses.

When encryption is unavailable or fails, the app shows a storage notice and keeps
queues in memory for that run, with no plaintext disk fallback. Invalid files
produce a visible notice and an empty queue. The legacy global player file is
neither imported nor modified. Retention/deletion controls remain later work.

## Verification and review handoff

Run `npm run check`, `npm run test:integration`, `npm run test:migrations`, and
`npm run test:electron`. The Electron journey uses actual local Auth/email,
safeStorage and P2 audio, with synthetic catalog/source subprocess responses and
generated WAV data. No live provider or hosted email is required. Only the test
fixture users/messages and isolated test profile are removed.

Additional unit coverage exercises ciphertext/owner validation, unavailable
encryption, retained A/B queues, late saves/loads/resolutions, forged IPC, denied
legacy access, preview mode restoration, queue size/order/duplicates, source errors,
and system media cleanup. Standalone P2 tests retain their download/file coverage.

Validation on 2026-10-31: the production build and type checks passed, along with
165 unit tests, 18 shared contract tests, six standalone P2 tests, 19 local database
integration tests and the populated-data migration check. The real local-email
Electron journey passed preview/full-track fixture playback, duplicate retention,
paused encrypted restart, guest/B/A isolation, keyboard resizing, dialog focus,
library filtering and a long title. A separate HTTP-hosted browser-demo test passed
without desktop bridges, and the standalone native P2 bridge smoke test passed.
The saved-track-to-another-playlist append regression passed. The UI correction
uses P1's original component and its original menu/search interactions, rather
than the former replacement layout. P1's core styles, ContextMenus and PlayerPanels
are unchanged. The current workspace passes 194 unit tests after teammate updates.
A focused check verifies P1's library-search interaction at 1050 px. The Windows
`launch.ps1 -BuildOnly` check also passed.
Visual review artifacts are retained under the ignored `work/review/` directory.

P1 review request: unified shell behavior, keyboard focus, resizing and the bridge
consumer. P2 review request: scoped renderer factory, bounded queue validation,
media-session teardown and source-process cancellation. Requests are documented
for handoff; no teammate approval or external message delivery is claimed.
