# Person 1: packaged component and motion analysis

2026-10-31. Target remains installed Spotify Store package 1.306.1921.0. Original archive hash is recorded in 18. No native binary decompiler was used: these features are in the packaged JavaScript/CSS layer.

## Expanded analysis

Selected exact packaged chunks: dwp-top-bar.js (6,811 bytes), dwp-now-playing-bar.js (55,280), xpui-routes-your-library-x.js (145,074), xpui-routes-playlist.js (77,004), xpui-root-dialogs.js (237,441). Added associated dialog/panel CSS for static motion inspection. No Spotify scripts were executed or imported into Fyspoti.

REA analysis parent: ev_ced65ca42e9b16ac560fac68dae6879b12da35324843716625a3fa5ce37f92f6.
Summary: ev_c4159be3b9ef26d25a425aaf5c0b36292709a029fba18df5b62967c88d4e02c8.
Module inventory: ev_81be52857f33779d41c97b64866f99eff1aa2e11955f4da4b4a38ac8cf104e96.
Export: work/spotify-components-evidence.json. Full hash manifest and extracted motion rule offsets: work/spotify-ui-reference/manifest.json and motion-rules.json.

The analysis recovered bundled modules and static observations but is partial: semantic retention reached 12,000 nodes and 3,000 unknowns. Dependencies outside the selected chunks remain unresolved. The focused toggleCollapseYLX string graph trace (ev_a8c3203b3c7d974fc9bdac0b436659e5fc9cbff72a4736000c6f1359e15daae9) returned no match; this is not evidence that collapse behavior is absent. Direct text inspection and live web behavior provide the evidence below. No claim of complete source recovery or full feature tracing is made.

## Source findings -> implementation

| Source observation | Result in Fyspoti | Authority and limits |
| --- | --- | --- |
| Library chunk includes explicit COLLAPSED/DEFAULT/EXPANDED handling and restores the prior uncollapsed mode | Collapse/open library, persisted state, independent expansion to 480px and return to 294px | Static behavior inspection; our expansion widths are chosen, not recovered constants |
| Library chunk lists LIST_COMPACT, LIST_DEFAULT, GRID_COMPACT and GRID_DEFAULT | Four persisted library view modes | Static enum/control configuration, corroborated by live web picker |
| Live web collapse yields a 72px sidebar; picker exposes compact/default lists/grids | 72px cover-only rail and matching mode labels | Live Spotify Web, not desktop runtime |
| Library chunk exposes onClick/onDoubleClick/onKeyDown/menu and drag callbacks | Track context menu plus keyboard Home/End/arrow navigation | New implementation; exact upstream key mapping not fully recovered |
| root-dialogs.css offset 388: 150ms cubic-bezier(0,0,.2,1); associated keyframes fade to 1 and start at translateY(10%) | Fade/slide editor dialog with the same declared timing/curve | Exact static parameters; selector may serve other dialog variants |
| now-playing CSS offset 10755: 220ms ease-in active-dot entry | Shuffle/repeat active-dot entry | Static parameter match |
| Panel CSS offsets 6406/6537: title-control opacity/transform 100ms ease-out, 100ms reveal delay | Hover/focus reveal on panel close control | Reimplemented control subset, not entire Spotify panel |
| Player transform CSS offset 4559: 250ms cubic-bezier(.3,0,0,1) | Library width and card movement easing | Timing reused as a design choice; exact selector is player transform, not library width |
| Root dialogs JS contains keyboard input handlers and focus cycling logic | Anchored, keyboard-operable menus; retained dialog focus loop | Similar semantics, no claim of byte-equivalent reconstruction |
| Player JS references stopwatch_activate/deactivate animation JSON with active/inactive states | Working local sleep timer (5/10/15/30/45/60 minutes), cancel and active state | Timer behavior implemented; source vector animations are not copied and icon does not reproduce them |

## Additional frontend corrections

- Repeat cycles Off -> All -> One; One repeats current preview, All allows wrapping. Off stops at the catalog end when no explicit queue remains.
- Replaying the current track resets the audio position.
- Library search expands/collapses and focuses its input.
- Right-click on a track opens its action menu instead of silently enqueueing it.
- Menus anchor to their trigger and constrain placement to viewport; Escape dismisses and focus returns to the trigger where possible.
- Album-card hover/focus controls now fade and lift into view. Menu/toast entry motion is reconstructed, not measured Spotify parity.
- Sticky playlist toolbar reacts to content scroll. Exact desktop sticky-header choreography remains unverified.
- Reduced-motion media query disables animation/transition including pseudo-elements.
- Cached real catalog metadata displays during online refresh.

## Verification

TypeScript compilation passed. Browser checks verified settled collapsed width 72px; expanded width 294px; compact grid three 90px columns at that width; mode picker End key moves focus to Default grid; repeat reaches One; timer activation exposes cancellation and cancellation succeeds. Dialog computed animation is 0.15s with cubic-bezier(0, 0, 0.2, 1).

Five-minute timer expiration was not waited out; the timer uses a cancellable timeout and pauses the local preview player. All backend limitations from 16 remain. Frame-by-frame desktop runtime equivalence, every inactive code variant and proprietary vector icon animations remain unresolved.

## Pages/features updated

Persistent shell/library: collapse, expand, four display modes, search expansion and transitions.
Playlist/track table: anchored context actions, sticky toolbar, keyboard menus.
Player: three-state repeat, sleep timer, device-selection placeholder panel and active-state motion.
Editors: recovered entry curve plus existing upload/focus behavior.
Home/cards: hover/focus play-button reveal.

Source references remain analysis-only under gitignored work/. Production bundles contain original application code, not upstream JavaScript/CSS files.
