# Accounts, privacy and cloud synchronization

Owner: P3. Accounts and cloud library sync are launch requirements.

## Model

Own app accounts are separate from any Spotify/provider connection. An optional provider connection grants only its actual authorized capabilities. Never embed confidential OAuth client secrets in distributed desktop code. Use the selected identity provider's supported desktop flow and secure token storage; review current official documentation during implementation.

## Implementation sequence

1. Select cloud/auth service and region; establish development and production environments with migrations.
2. Implement signup/login, recovery, session refresh, logout and profile editing.
3. Enforce per-user access in the database/API, including private playlists, covers and history. Test using two independent accounts.
4. Persist a per-account SQLite cache and mutation outbox. UUID mutation IDs make replay idempotent; server revisions order accepted changes.
5. Sync on startup, reconnect and local mutation. Pull cursor changes including deletion tombstones; never use client timestamps alone for ordering.
6. Handle revoked sessions without losing pending edits. Explain whether reauthentication is required to upload them.
7. Add preferences, session revocation, data export and account deletion, including linked storage cleanup.

## Conflict policy

- Likes/saves: server-ordered explicit add/remove operations.
- Metadata edits: expected revision; refresh/retry on conflict rather than silent overwrite.
- Playlist inserts/removes: stable item IDs, idempotent operation IDs and server revisions.
- Reorders: reject stale base revisions at launch, fetch current order and let the user retry. Later collaborative ordering can use a more capable scheme.
- Delete: tombstones prevent stale installations from resurrecting removed entities. Establish retention/expiry during implementation.

## Privacy and history

Private Session prevents eligible activity from being published and excludes it from recommendation/statistics inputs according to the app's documented policy. Separate necessary local resume state from optional cloud history. P4 receives only permitted listening events. Block rules apply to messaging/following and content sharing, not just rendering.

Preferences include explicit-content filtering, activity sharing, notifications, language and storage-related UI settings. P2 owns device-local audio settings and paths. Later: managed child accounts and parental restrictions; no paid subscription or billing tables are required.

## Acceptance

Verify account A cannot read/write B's private entities or object storage. Reconnect after offline edits and retry duplicate network requests. Sign out/in as another user without cache leaks. Test token expiry/revocation, migration rollback strategy, server outage, export completeness and deletion across sessions. Validate two installations converge on the same personal library without syncing audio files.

Reference: [Spotube app reference map](02-upstream-references.md). The account/cloud system is our own design; it is not claimed to be inherited from Spotube.
