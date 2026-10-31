# Person 1: interface ownership plan

## Outcome

A Spotify Windows-style music interface built fresh. Spotube supplies architectural ideas; none of its visual shell is the default.

## Owned work

- Design tokens, CSS, reusable controls, typography, spacing, icon system, overlays and accessibility.
- Window shell, navigation/back-forward, Home, Search, artist, album, playlist, library, downloads, settings and account layouts.
- Persistent bottom player, queue/right panels, expanded player, responsive resizing and Windows title-bar behavior.
- Present search filters, discographies, credits, library sorting, folders, playlists, download progress and errors.
- Lyrics, translations, visuals and song-information presentation; see 12.
- Later social, statistics, concert, venue, tickets and merchandise presentation.

P2/P3/P4 implement feature-specific panels using these components. P1 does not own every feature's state or backend.

## Sequence

1. Complete the versioned baseline in 07; inventory visible controls and interaction states.
2. Build shell, tokens, track table, card grid, menus, dialogs and player controls against shared fixtures.
3. Connect launch routes to contracts; preserve scroll, selection, focus and navigation state.
4. Complete loading/offline/empty/error variants, keyboard interactions and Windows scaling checks.
5. Add lyrics and later parity views without redesigning the shell.

## Handoffs

- P2 supplies player/download state and commands; no second queue maintained in React components.
- P3 supplies authenticated profile, library, playlist and settings models.
- P4 supplies catalog and discovery models; media URLs are treated as untrusted data.

## Acceptance

- Every launch route has visual comparison captures at agreed sizes and DPI.
- Track row double-click, selection, menus, drag interactions and player controls follow the recorded baseline.
- Navigating never stops playback or resets queue state.
- Long names, missing artwork, large playlists and network failure do not break layout.
- Keyboard-only operation, focus restoration and accessible names work.

## Codex task example

Implement the album page using the approved baseline and fixture schema. Reuse TrackTable; wire play/save through injected contracts. Include loading and unavailable states. Do not change player, authentication or provider code. Return screenshots and relevant check results.

References: [UI plan](07-ui-rebuild.md), [Spotube reference boundaries](02-upstream-references.md).

## Implementation tracking

See [page and feature implementation log](16-person-1-implementation.md) and [verification](17-person-1-verification.md).

## REA evidence pass

See [Spotify static investigation and reconstruction ledger](18-spotify-rea-investigation.md). Runtime frame equivalence remains unresolved; UI changes are linked to static evidence and screenshots.


## Live web comparison

See [measured web reference and implemented improvements](19-spotify-web-comparison.md).


## Packaged components and motion

See [deeper source analysis, implemented controls and motion verification](20-ui-components-and-motion.md).


## Queue and Connect correction

See [queue/sidebar rebuild and menu audit](21-queue-connect-menu-audit.md).



## Team integration

See [P2/P3/P4 integration, behavior changes and requests to other owners](22-person-1-integration.md).


## Context menus

See [desktop-derived track and playlist menus](23-context-menus.md).


## Error log

See [errors seen during integration, causes and status](24-person-1-error-log.md).
