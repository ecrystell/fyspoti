# Person 3 — Part 2B: local email accounts and desktop library

The Electron app now uses passwordless email codes and the real account-scoped
library. Browser development (`npm run dev`) retains P1's separate prototype.
Existing `fy-*` localStorage playlists, likes and profile data are neither displayed
as cloud data nor imported. A new account starts with an empty library.

After merging the shared shell, `electron/main.ts` and `electron/preload.ts` build
to `dist-electron/` and install both P2 and P3 bridges. P1/P2's local playback
prototype remains available by building with `VITE_FYSPOTI_DESKTOP_MODE=prototype`.
The default account UI continues using ephemeral previews; connecting its private
queues to P2's device-wide persistence still requires account-scoped storage.

## Run locally

Use Node 24, the pinned npm dependencies, Docker Desktop (Linux containers), and
Supabase CLI 2.118.0. From the repository root:

```powershell
npm ci
npm run setup:desktop
npm run cloud:start
npm run build
npm run desktop:local
```

`desktop:local` reads the local stack's publishable key into the main process
environment without writing a credential file. For manual `npm run desktop`, copy
`.env.desktop.example` to `.env.desktop` and supply the local publishable key.
Never put service-role, secret, admin or access-token credentials in that file.
The app does not read `.env.cloud` or test provisioning credentials.

An existing local stack needs the forward profile migration applied and an Auth
restart to pick up the email template. Stop/start preserves its database:

```powershell
supabase migration up --local --workdir services/cloud
npm run cloud:stop
npm run cloud:start
```

For a disposable clean local database, `npm run cloud:reset` applies all committed
migrations; this deletes the local database's current data. No hosted reset is used.

Click **Sign in**, enter a synthetic address such as `listener@example.test`, and
open the local mail catcher at `http://127.0.0.1:54324`. Paste its six-digit code.
Local emails are captured by Mailpit and do not reach a real inbox. The templates
render a code rather than a login link; codes expire after ten minutes and resend
has a sixty-second cooldown. Invalid/expired codes and service/rate-limit errors
have visible retry paths.

## Delivered behavior

- Profile creation and display-name edits use an owner-scoped profile RPC with
  revision checks and the existing account/operation mutation receipts.
- Likes and private playlist creation, rename, item removal, manual reorder and
  deletion use the existing transactional Part 2A API. Duplicate tracks retain
  separate item IDs. Reorder requires all items loaded, no filter and Custom order.
- Saved tracks display their stored metadata without a catalog lookup. Pagination,
  conflicts and uncertain-write retries remain explicit. Unknown duration is `—`.
- P1's online preview metadata retains the iTunes provider ID and maps it through
  P4's deterministic provisional-ID helper. Preview URLs are ephemeral, separate
  from cloud track identities and snapshots.
- Playlist play actions prepare the existing consistent queue snapshot. The
  desktop screen still uses preview audio; P2's player/download files, persistent
  queues and worker are unchanged. Full-track resolution remains separate work.
- Logout/account changes clear private view state and preview playback. Account
  epochs and the library controller discard late responses from a former account.

## Trust boundaries

Supabase Auth and library requests run in Electron's main process. The sandboxed,
context-isolated renderer receives only sanitized account/library state through
named preload methods. Main-frame identity, exact application URL and strict Zod
payload schemas guard IPC. No generic IPC, SDK client or tokens are exposed.
Production CSP restricts scripts, navigation, catalog connections and media hosts.

Refresh/access tokens are stored only in the main process, encrypted using
Electron's asynchronous OS safeStorage APIs in `userData/accounts/session.enc`.
Writes are serialized and atomic; retiring a storage generation blocks late SDK
writes after logout. If OS encryption is unavailable, the app shows a notice and
keeps the session in memory for that run. Restore verifies the user with Auth;
transient outages retain encrypted credentials for retry, rejected credentials
are cleared. Sign-out clears local state even if server revocation fails.

Profiles have owner-only RLS reads and no direct client writes. The narrow public
RPC delegates to a private function with a fixed empty search path and explicit
authenticated-account checks. Likes/playlists retain Part 2A's RLS and receipts.

## Repeatable checks

```powershell
npm run check
npm run test:migrations
npm run test:integration
npm run test:electron
npm test --prefix p2
npm run cloud:advisors
```

The Electron check uses the installed Electron executable, actual local Auth,
Mailpit and the database. Only catalog responses are fixtures. It verifies code
delivery, sign-in, separate prototype storage, cloud likes, duplicate playlist
entries, removal of one duplicate, profile edits, ciphertext storage, application
restart/session restore and account B isolation. It uses an isolated ignored
`work/electron-e2e/` profile and deletes only its own users and captured messages.
Its parent test process provisions cleanup credentials; the application child
never receives them. The screenshot is `work/electron-results/cloud-library.png`.

The migration check upgrades populated Part 1 data through Parts 2A and 2B in a
disposable local database. Integration checks include direct REST/RPC isolation,
profile receipts, stale edits and account mismatch. Unit checks cover unavailable
OS encryption, failed sign-out, invalid codes, cooldowns, late verification,
concurrent account actions and canonical provider identity.

Validation on 2026-10-31: production build/type checks, 63 unit tests, 17 catalog
contract tests, 19 database integration tests, six P2 tests and the populated-data
migration check passed. The actual local email/Electron journey passed, including
OS-encrypted session restore after restart. Local database advisors reported no
issues at warning/error level.

## Handoff and deferred work

P1 should review `CloudBridge` and the desktop presentation; P4 should review the
iTunes-to-provisional-ID mapping; P2 should review future player wiring. No human
teammate approvals are claimed. Existing library compatibility exports remain.

**Hosted email delivery, SMTP configuration, hosted profile migration and hosted
validation are deferred at the user's request.** This milestone is validated only
against local email and local Supabase. It does not certify hosted OTP delivery.
Production packaging, profiles beyond display name, saved albums/artists,
desktop Spotify import, offline cache/outbox/sync, covers and public sharing remain
later work. Mutation receipts and tombstones retain their existing retention.
