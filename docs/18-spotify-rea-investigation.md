# Spotify REA investigation and UI reconstruction

Date: 2026-10-31. Owner: Person 1.

## Target and configuration

REA MCP is connected, package rea-agents 6.8.0, skill version 49. No global MCP configuration changes were needed. Used portable archive and inert JavaScript analysis; no Ghidra/native decompiler required for this UI pass.

Installed target: SpotifyAB.SpotifyMusic_1.306.1921.0_x64__zpdnekdrzrea0, Apps/xpui.spa. SHA-256: 1cfae00b62fb3bdc2e7d10c695784431e1497c4ee63c4b8b38bbb3bf4e67d245.

REA open_binary detected ZIP. inspect_artifact refused the archive root entry `/` as unsafe. Its safeguards were not changed. Selected exact file names were extracted with .NET ZipArchive to work/spotify-ui-reference; no arbitrary archive paths were used and the installed app was not changed. This selected-file extraction is a shell observation, not successful REA archive inventory.

Static REA input: extracted index.html and xpui-snapshot.js. Source selection accepts JavaScript/HTML, not CSS; CSS was read separately as inert text. Script content was not executed.

## Evidence

- REA summary: ev_79cfe10d9ee634de0c0e2557de3dfdb79146eff2ea5436f00c2ebfa64f27bd78.
- Retained full analysis: ev_8b949f999a3d865b696db469a9c37f4e2c21cdf664f6d812a2a1d5339bcac5c5.
- Export: work/spotify-rea-evidence.json, containing two Evidence records. Treat as local reference material, not redistributable application assets.
- Shell extraction manifest: work/spotify-ui-reference/manifest.json. Refresh hashes after adding files; initial manifest predates extracted bootstrap.
- The bootstrap is 10,966 bytes and references externally supplied __webpack_modules__. One JavaScript file parsed, 8 findings, no parse failures. Application graph partial; semantic coverage unknown with 566 unknowns. No complete app source or runtime behavior was recovered.

## Finding ledger

| Finding | Authority | Applied change |
| --- | --- | --- |
| Base surface #121212, elevated #1f1f1f, highlight #2a2a2a, subdued text #b3b3b3, accent #1ed760 | xpui-snapshot.css, encore-dark-theme | Original CSS token layer in src/reference.css |
| Spacing scale 2/4/6/8/12/16/20/24/32/40/48/64; panel radius 8 | xpui-snapshot.css, encore-layout-themes | Consistent panel/control/dialog spacing |
| Profile editor max width 524, image 180, 16px grid gap, input height 40 and surface #282828 | xpui-routes-profile.css | Image/name/description/save dialog grid and image upload |
| Track table transparent row border, 4px radius and variable row height | xpui-snapshot.css | Selection/hover borders; existing screenshot-based 70px row retained |
| Active transport dot 4px and green hover/pressed states | dwp-now-playing-bar.css and snapshot theme | Shuffle/repeat active indicator and button states |
| Profile/playlist/album/artist/search/library style chunks exist | Explicit ZIP entry listing | Route inventory corroborated; filenames alone do not prove active functionality |
| 64px topbar and fluid header clamps exist | dwp-top-bar.css | Recorded reference only; not blindly substituted for screenshot's 80px desktop header |

The user screenshots remain the visual authority for desktop geometry. Static rules have variant selectors and may be inactive. The screenshots suggest scaling but their effective CSS zoom is unverified. Proprietary fonts were inventoried but were not copied into the app, so typography is not identical.

## Frontend changes in this pass

- Added reference-derived palette, border/radius and control-state CSS, implemented independently rather than importing Spotify's stylesheet.
- Added pointer and keyboard resizable library and right panels; widths persist locally.
- Added local playlist cover and profile-photo upload (actual selected images, no generated art), preview and persistence; maximum input size 2 MB.
- Added dialog Tab cycling and focus restoration; reduced-motion overrides.
- Existing Home, playlist, profile, album/artist, search and settings continue using real online metadata and artwork.
- No Spotify script, font, audio credential, private API or binary is shipped with Fyspoti.

## Runtime/frame coverage and blocker

Attempted to launch the installed Store Spotify executable with a loopback-only debugging endpoint on port 9223. Windows returned Access denied before launch. No endpoint was created and no runtime frames or transition timing were observed. REA's native UI observation is macOS-only on this host. No protection changes or permissions to the Store package were attempted.

| Frame/state | Evidence | Reconstruction status |
| --- | --- | --- |
| Home, playlist, profile resting states | User screenshots + static style rules | Implemented, exact screenshot diff still pending |
| Edit dialog open/focus/fields/save | Static profile editor layout; own implementation | Implemented; runtime Spotify state unverified |
| Library/right panel resizing | Own reconstruction feature | Implemented; source runtime interaction unverified |
| Hover/pressed/active transport | Static styles | Implemented; timing/variant unverified |
| Album/artist/search/settings | Existing frontend + static chunk inventory | Implemented prototype; no matching Spotify frame capture |
| Page transitions and all animation frames | No runtime capture | Unresolved; cannot claim frame-by-frame equivalence |

Next required evidence: a Spotify runtime reachable through a supported local inspection endpoint, or dated screenshot/video captures of each interaction state. Opening Spotify normally alone does not supply REA a CDP endpoint. Do not silently substitute Spotify Web and call it desktop evidence.

## Verification

TypeScript compilation passed after this pass. Production build and browser smoke results are appended below. This is a bounded static reverse-engineering pass, not a complete reverse engineering of Spotify or full parity certification.

Final verification: TypeScript and Vite production build passed. Browser loaded the refined UI and online artwork. Keyboard resizing changed library width from 368 to 384 pixels. Save -> Tab returned focus to Close dialog. Editor screenshot saved for review. Image upload UI is present; file upload/persistence was not exercised in this pass. Updated manifest hashes all selected extracted files, excluding the manifest itself.

