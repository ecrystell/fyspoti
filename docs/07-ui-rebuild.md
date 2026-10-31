# Spotify Windows UI rebuild

Owner: P1. Contributors: each feature owner implements domain-specific panels using shared components.

## Goal and reference

Reproduce the current Spotify Windows desktop information hierarchy, density, layout and music interactions in a fresh UI. Do not reskin Spotube's existing screens. Use original app branding/assets. Architecture reference: [Spotube](https://github.com/team-spotube/spotube); UI authority: a dated capture of the actual Spotify desktop application.

## Baseline before implementation

Record app version, capture date, account/market, window size and DPI. Capture Home, Search/results, artist, album, playlist, Liked Songs, Library, queue, expanded player and settings. Record hover, selected, playing, menu, modal, drag, empty, loading and offline states. Measure typography, row heights, panel widths, gaps, radii and icon sizes. A Spotify A/B test is not a new specification until deliberately adopted.

Proposed QA sizes: 1280x720 and 1920x1080 at 100% scaling, plus 150% Windows scaling. These are test targets, not observed Spotify measurements. Keep baseline images and interaction notes together; mark unobserved states as pending rather than guessing exact values.

## Implementation sequence

1. Tokens and primitives: text, icon button, slider, tooltip, menu, dialog, toast, skeleton and focus ring.
2. Persistent shell: title bar, top navigation/search, library sidebar, central content, optional right panel and bottom player. Match the captured arrangement; persist user-adjustable panel sizes.
3. Shared content: virtualized track table, artist/album cards, cover header, filters, sorting and context actions.
4. Launch routes and state binding: route changes do not recreate the audio engine. Deep links restore the correct route; back/forward restores scroll.
5. Editing: multi-selection, keyboard shortcuts, drag reordering, save/like feedback and accessible dialogs.
6. Downloads/account/settings routes; omit podcast, audiobook, upgrade and advertisement surfaces entirely.
7. Lyrics/visuals, then social and stats views when their contracts exist.

## State and dependencies

Use P2's single player state, P3's authoritative library mutations and P4's cursor-based search. Optimistic actions require rollback and visible failure. Debounce search and discard late results. Unsupported source capabilities must not render as working controls.

## Acceptance and verification

- Compare screenshots with the frozen baseline using identical fixture content and dimensions; record deliberate exclusions.
- Test keyboard focus, context-menu dismissal, slider operation and playlist drag/drop.
- Verify long/localized text, missing covers and thousands of rows through virtualization.
- Offline/unavailable controls explain status; no dead buttons disguised as parity.
- Person 1 reviews shared design changes, but does not become a gatekeeper for every feature commit.

Deliverables: baseline manifest, token sheet, component gallery, route inventory and visual comparison report.
