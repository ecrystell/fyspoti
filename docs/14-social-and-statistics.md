# Social, group listening and statistics

Owner: P4. P3 supplies identity/private-library primitives; P2 supplies playback state; P1 supplies shared UI.

## Launch

Share links to tracks, albums, artists and public playlists. Resolve them to app routes and a minimal web landing page if hosting is available. A link never grants access to a private playlist. Store listening events needed for later statistics, respecting privacy preferences.

## Social delivery order

1. Following/followers, profile visibility, share cards and scannable content codes.
2. Collaborative playlists: invitations, viewer/editor/owner roles, revocation, operation IDs and realtime updates over P3's playlist model. Review database access checks with P3.
3. Blend-style mixes: consent, participant taste inputs, taste-match calculation and exit/removal behavior.
4. Jam: session membership, host/participant roles, shared queue, invitations and remote readiness. Keep session control separate from the player engine.
5. Messages: consent-based requests, text/content sharing, emoji reactions, delivery state, blocking and reporting.
6. Listening activity and Jam requests in Messages, controlled by privacy settings.

## Jam design

Use server-assigned sequence numbers and an authoritative session queue. Host changes carry track ID, position and a server time anchor; clients estimate clock offset and report buffering. Reconcile drift with bounded seek correction. Resolve each participant's source locally; do not redistribute audio from the host. Explicitly handle a participant lacking the same recording or source access. Reconnect retrieves a snapshot before accepting new commands.

Device handoff is a P2 feature; group membership and queue authority are P4 features. Avoid building two incompatible session systems.

## Statistics plan

Aggregate P3's deduplicated eligible events into listened time, top tracks/artists, repeat mixes, weekly snapshots, annual top-song playlists, Wrapped stories and milestones. Version calculation rules and time-zone handling. Exclude private/ineligible sessions and document offline-event late arrival. P1 renders the stories/cards; calculations belong here.

## Implementation and acceptance

Create social schema migrations and access policies within P4's ownership; do not send the whole backend workload to P3. Start with contracts/fake realtime events, then prove cross-account behavior. Test revoked invites, private links, blocked users, reconnect replay, concurrent edits, Jam host departure, source mismatch and duplicated listening events. Compare statistics to a small hand-calculated fixture before adding animations.

Reference: [Spotify Messages](https://newsroom.spotify.com/2025-08-26/introducing-messages-a-new-way-to-share-what-you-love-on-spotify-with-friends-and-family/), [activity/Jam requests](https://newsroom.spotify.com/2026-01-07/listening-activity-request-to-jam-messages-updates/), [Spotube app reference](02-upstream-references.md). These are new app-owned services, not functionality presumed reusable from Spotube.
