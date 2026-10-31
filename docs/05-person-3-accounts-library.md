# Person 3: accounts and personal data ownership plan

## Outcome

An account's library persists across restarts and synchronizes between installations, while downloads remain device-local.

## Owned work

- Authentication, session refresh/revocation, recovery, profiles and credential storage.
- Cloud schema for personal data, SQLite cache, migrations, offline outbox and synchronization.
- Likes, saved albums/artists/playlists, folders, pins, library filtering and search.
- Playlist CRUD, items/order, covers, visibility, recovery and import/export persistence.
- History storage, recent items, privacy settings, explicit-content preference and notifications.
- Personal data export/deletion, blocked-user records and connected-app/session controls.
- Later managed accounts and household controls; no billing or paid plan work.

## Sequence

1. Prove two accounts cannot access each other's private data.
2. Ship profile, likes and playlist schema with migrations and contract fixtures.
3. Implement local cache/outbox and conflict rules in 10 and 11.
4. Add folders, covers, library tools, history and imports.
5. Complete settings, recovery, export/deletion and multi-installation checks.

## Split with Person 4

P3 owns personal data and playlist persistence; P4 owns discovery, social relationships, collaborative-operation coordination, messages, group sessions and statistics calculations. P4 defines social schema migrations under the same review rules. P3 supplies authorization primitives, not all of P4's endpoints.

## Acceptance

- Offline mutations sync once after reconnection and preserve intentional duplicates.
- Two installations reconcile concurrent playlist edits with explicit conflicts.
- Signing out prevents the next account from seeing private cached data.
- Removing a download never deletes the playlist or track identity.
- Account deletion and session revocation operate across cloud and local cache boundaries.

## Codex task example

Implement idempotent liked-track mutations and an offline outbox using the agreed revision contract. Test replay and cross-account authorization. Do not add social tables, renderer components or a new auth provider.

References: [Accounts/cloud](10-accounts-and-cloud.md), [library](11-library-and-playlists.md), [Spotube separation reference](02-upstream-references.md).
