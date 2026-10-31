# Person 1: track and playlist context menus

2026-10-31. The track menu used to list every playlist inline ("Add to all time", "Add to rn", …, "Add to X (cloud)"). It now matches the Spotify desktop structure: one **Add to playlist ▸** row that opens a filterable submenu.

## Evidence

Target: installed Store package `SpotifyAB.SpotifyMusic_1.306.1921.0`, `Apps/xpui.spa`, SHA-256 `1cfae00b…bcac5c5` (same as [18](18-spotify-rea-investigation.md)). The package was read only. Selected entries were extracted by exact name to the gitignored `work/spotify-ui-reference/`, and `manifest.json` was refreshed (25 files). No Spotify code, CSS, strings or fonts ship in Fyspoti.

| Source | Finding | Used for |
| --- | --- | --- |
| `i18n/en.json` | `contextmenu.add-to-playlist` "Add to playlist", `contextmenu.find-playlist` "Find a playlist", `web-player.aligned-curation.contextmenu.new-playlist` "New playlist", `search.empty-results-title` `No results found for "{0}"`, `save_to_your_liked_songs` / `remove_from_your_liked_songs`, `contextmenu.add-to-queue`, `contextmenu.remove-from-queue`, `contextmenu.go-to-artist`, `contextmenu.go-to-album`, `contextmenu.remove-from-playlist` | Exact labels and empty state |
| `xpui-snapshot.css`, submenu rule | `min-width:250px; max-height:50vh`. Height = items × item height + one item + a 32px filter row + dividers | Submenu structure: filter row, one fixed "New playlist" row, divider, scrolling list |
| `xpui-snapshot.css`, menu rules | Menu `min-width:160px; max-width:350px; max-height:calc(100vh - 24px); overflow-y:auto`. Surface padding 8px, radius 8px, rows 32px (`control-size-smaller`), divider margin 8px, shadow `0 4px 6px #0000004d`. Trailing submenu chevron | `src/context-menu.css` geometry |
| `xpui-routes-your-library-x.js` | Readable own-playlist menu composition: edit and delete group, then a `divider:"before"` Create playlist, then the add-to-other-playlist item (`itemsToBeAdded`), pin (`canPin`/`isPinned`), then a `divider:"before"` Share submenu holding `contextmenu.share.copy-playlist-link` "Copy link to playlist" | Playlist "More options" order and labels |
| [21](21-queue-connect-menu-audit.md), live web observation | Track menu order: Add to playlist, save/like, enqueue, remove, artist/album navigation | Track menu order |

### What could not be recovered

- The track context menu's own code, and the individual menu-item components, are not in any readable `xpui.spa` chunk. `xpui-snapshot.js` only runs webpack against an injected `__webpack_modules__` table. That core table, including module 6509 (the add-to-playlist submenu), is not present as text anywhere in the install or user cache. It is presumably in a compressed V8 startup snapshot. So the **track** menu order comes from the doc 21 observation, not desktop code.
- In the playlist menu, items whose identity rests only on props (likely Add to queue, Add/Remove profile, Create folder, privacy, Exclude from taste profile, Embed) were not adopted, and there are no Fyspoti features behind them.
- **REA:** the MCP server is registered for Codex only (`~/.codex/config.toml`). The CLI (`rea-agents` 6.8.0) was run directly from its cache, with no configuration changed. `analyze-web-bundle` on the public, signed-out web player gave evidence `ev_8e3bd1c8…2235b7` (`work/spotify-web-bundle-evidence.json`), but captured **0 sources** because the page had loaded before observation started. The web player also served the mobile build to Electron's user agent. A user-agent override to get the desktop web build was blocked by the session's safety policy and was not attempted another way.

## Implemented

`src/ContextMenus.tsx`, `src/context-menu.css`:

- `SubmenuItem`: menu row with a trailing chevron. It opens on hover (150ms close grace) or on click, Enter, Space or →.
  - Placement: rendered in a portal, because the parent menu scrolls and has a transform. It opens beside the trigger and flips left or up when there is no room.
  - Keyboard: Escape or ← closes it and returns focus to the trigger, ↑/↓ move between rows, and Home/End jump to the first or last row.
- `AddToPlaylistItem`: the **Find a playlist** filter, **New playlist**, a divider, then matching local and cloud playlists ("Cloud" tag) in a scrolling list, with the empty state `No results found for "…"`.

Track menu (rows and queue): Add to playlist ▸, Remove from this playlist (local playlist only), Save to / Remove from your Liked Songs (shows the current state), Add to queue, Remove from queue (queue only), divider, Go to artist, Go to album.

Playlist "More options": Edit details, Delete, divider, Create playlist, Add to other playlist ▸ (copies this playlist's tracks), Pin/Unpin playlist, divider, Share ▸ Copy link to playlist. Cloud playlists offer Add to other playlist, Create playlist and Reload from cloud. Album, artist and Liked Songs pages offer Add to playlist ▸ for the whole collection.

"New playlist" creates a local playlist containing the selected tracks. Adding to a cloud playlist writes one item at a time and stops at the first failure without replaying, as P3 M0 requires.

## Verification

Live Electron run, driven over the DevTools protocol:

- Right-clicking a row gave: Add to playlist | Remove from this playlist | Save to your Liked Songs | Add to queue | — | Go to artist | Go to album.
- → opened the submenu, 250px wide and directly beside the menu, with focus in Find a playlist.
- Typing "zo" filtered the list to zorp. ↓↓ then Enter added the track ("Added to zorp", 8 → 9 tracks) and closed the menu. The test addition was not flushed to disk, and zorp was confirmed at its original 8 tracks after a restart.
- The playlist menu listed Edit details | Delete | — | Create playlist | Add to other playlist | Unpin playlist | — | Share. Hovering Share showed Copy link to playlist.
- No page exceptions. Typecheck passed and 53 unit tests passed.

First run found and fixed a bug: the submenu took focus while still `visibility:hidden` during measurement, so keyboard opening left focus nowhere.

Not verified: screen reader announcement, a submenu flipping at a narrow window edge, and cloud adds against a real database (still blocked; see [17](17-person-1-verification.md)).
