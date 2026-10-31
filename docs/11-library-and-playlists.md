# Library and playlist plan

Owner: P3. P4 contributes collaboration and catalog imports; P1 contributes views; P2 supplies artifact availability.

## Feature inventory

Launch: Liked Songs; saved albums/artists/playlists; personal playlists; item editing and ordering; descriptions/covers; public/private visibility; profile listing; folders/pins; search/sort/filter; downloaded filter; history/recent items; save another playlist; delete/recover playlists; basic playlist import/export.

Later parity: richer in-app cover creation with P1, filtered Liked Songs -> playlist, advanced Smart Filters with P4 and collaborative editing coordinated by P4. Import compatibility is provider-dependent, not a promise of unrestricted Spotify library access.

## Data and implementation

1. Create tables for saved entities, playlists, playlist items, folders, pins, history and tombstones. Use app canonical track IDs with metadata snapshots for offline display.
2. Build read/query APIs and paginated local views. Preserve intentional duplicate tracks through distinct playlist-item IDs.
3. Implement idempotent mutations and revision checks from 10; cache optimistic changes with rollback/conflict presentation.
4. Store covers in bounded object storage with validated file type/size; permit original artwork uploads and editor-generated covers.
5. Add folder nesting with cycle prevention, pins and persisted sort preferences. Deleting a folder must clearly define whether playlists survive; default to preserving them.
6. Define public links separately from ownership. Removing a playlist from a profile does not automatically make it private; UI must show both settings clearly.
7. Import through a preview: map tracks, show unmatched/ambiguous rows, preserve order/duplicates and require explicit confirmation before replacing existing contents. Export app metadata/playlist references independently of audio downloads.
8. Record listening events from P2 once, with privacy eligibility, and expose recent/history views. P4 computes stats from these records.

## Cross-owner seams

P3 owns playlist persistence and authorization primitives. P4 adds invitations, collaborator roles and live operations against those same records; do not create a second playlist database. Download records reference tracks/collections but remain P2's device-local authority. Smart Filters depend on P4 classification, not guessed labels in the renderer.

## Acceptance

Verify a large playlist remains usable; duplicate additions preserve intended behavior; sorting does not overwrite manual order; drag reorder survives reload; concurrent edit surfaces a conflict; a private playlist cannot be read by link guessing; import previews failures; deleted items do not reappear after sync; offline metadata stays available after source outage.

References: [Spotify Library behavior](https://support.spotify.com/uk/article/your-library/), [folders](https://support.spotify.com/br-en/article/playlist-folders/), [upstream reference boundaries](02-upstream-references.md).
