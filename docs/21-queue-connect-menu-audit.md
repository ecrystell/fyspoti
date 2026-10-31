# Person 1: queue, Connect and menu audit

2026-10-31. Inspected the user-authorized Spotify Web Chrome tab. Opened Queue, Connect, queue-track menu, account menu, Create menu and library-view picker. No saved Spotify content was changed and playback was not started or transferred on Spotify. Returned the reference to Now Playing after inspection.

## Verified reference behavior

- Queue occupies the right sidebar with its own header and Close action.
- Now playing row: current track title in green, artist underneath, 48px cover in a 64px row.
- Remaining context is labeled Next from: [playlist]. Explicit additions use Next in queue separately.
- Actions appear through hover/focus ellipsis menus, not a permanent inline X.
- Queue track menu exposes Add to playlist, save/like, enqueue, remove, artist/album navigation and other service-dependent actions.
- Connect replaces the right sidebar, rather than appearing as a floating context menu. It has a Connect header, current device card, no-other-devices guidance and help links.
- Library-view picker exposes four list/grid modes; inspected previously and rechecked during this series.
- Account and Create menus were inspected; personal notification text was not copied into application fixtures.

## Implemented

New src/PlayerPanels.tsx and src/player-panels.css replace the primitive queue and device popup.

- Queue: correct row dimensions, two-line metadata, ellipsis reveal, current-track accent, truncation, selection, keyboard Enter/Shift-F10, right-click menus and same-section drag reorder.
- Separate manual queue and playlist-context state. Next prioritizes explicit queue entries. Selecting a future track consumes earlier entries from its section. Clear queue clears manual additions without erasing playlist continuation.
- Per-occurrence remove from queue through its menu; no permanent X beside every song. Artist/album navigation and Add to queue work against local catalog state.
- Connect: docked sidebar, current computer card, local playback status, truthful discovery-unavailable guidance and reference help links. Remote discovery/transfer remains backend work.
- Header Close remains visible for Queue/Connect, independently of Now Playing's hover treatment. Footer active indicators track the selected panel.
- Reference covers now use the larger observed d72c artwork variant rather than thumbnail dec5 variants where applicable.

## Verification

TypeScript/production build validation recorded below. Browser tests: opened a collection and paused the local preview; Now playing and Next from: all time rendered; adding one context track created Next in queue; Clear queue removed only that explicit section. Measured row height 64px and cover width 48px. Connect is inside .right-panel and opening it produced zero floating .menu elements. Screenshots captured for Queue and Connect.

## Menu/interface audit status

| Interface | Reference inspected | Fyspoti status |
| --- | --- | --- |
| Queue panel | Yes | Rebuilt and tested |
| Connect panel | Yes | Rebuilt; remote service unavailable |
| Queue-track menu | Yes | Core local actions implemented; radio/credits/taste services remain unavailable |
| Library view modes | Yes | Four modes implemented |
| Library collapse | Yes | Implemented at 72px |
| Account menu | Yes | Profile/settings work; cloud account/updates not connected |
| Create menu | Yes | Local playlist creation works; reference Blend/Folder popover not yet recreated |
| Sleep timer | Packaged source reviewed | Local timer implemented; complete web equivalence not established |
| Lyrics, notification, sharing and recommendation variants | Partial | Requires further reference work and provider contracts |

No claim that every Spotify menu or animation has been exhaustively recreated. Only the states above were inspected. New sidebar fade is an implementation choice; exact desktop transition timing remains unverified.

Final production TypeScript and Vite build passed. Browser CDP timed out while attempting the final Connect screenshot; earlier DOM and visual checks confirmed docked placement. Screenshot coverage is limited accordingly.

