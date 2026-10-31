# Windows music app: implementation plans

Drafted 2026-10-31. These are plans, not implemented features.

## Confirmed decisions

- New application, not a Spotube fork.
- Windows desktop first.
- Match the current Spotify Windows desktop layout and music interactions; replace Spotube's presentation completely.
- Free, without app-inserted advertising, subscriptions, podcasts, or audiobooks.
- Streaming and offline downloads both ship at launch.
- Accounts and cloud library synchronization both ship at launch.
- Four equal owners; no integration lead. Each owner integrates and tests their changes.

## Read order

1. [Architecture and contracts](01-architecture.md)
2. [Upstream references](02-upstream-references.md)
3. Your ownership plan, followed by its subsystem plans.
4. [Delivery and Codex workflow](15-delivery-and-codex.md)

| Owner | Ownership plan | Subsystems |
| --- | --- | --- |
| Person 1 | [Interface](03-person-1-interface.md) | [UI rebuild](07-ui-rebuild.md), [lyrics and visual media](12-lyrics-and-visuals.md) |
| Person 2 | [Playback](04-person-2-playback.md) | [Player](08-player-and-devices.md), [downloads](09-downloads-and-offline.md) |
| Person 3 | [Accounts and personal data](05-person-3-accounts-library.md) | [Accounts/cloud](10-accounts-and-cloud.md), [library/playlists](11-library-and-playlists.md) |
| Person 4 | [Catalog, discovery, social](06-person-4-catalog-social.md) | [Catalog/recommendations](13-catalog-and-discovery.md), [social/statistics](14-social-and-statistics.md) |

## M0 results

- [Provider spike](16-provider-spike.md): selected sources, measurements and the YouTube exception that needs team confirmation.
- [Provider capability matrix](17-provider-capability-matrix.md): what each source can do, and the permitted-content fallback.
- [Draft shared contracts](../packages/contracts/README.md): proposed catalog schemas, pending P1, P2 and P3 review.

The repository is licensed under [MIT](../LICENSE). Public repository rules are in the spike report.

## Scope and sequencing

Launch means the launch column below, not the full long-term parity backlog. Advanced features remain assigned so they do not silently disappear.

| Area | Launch | Subsequent parity work |
| --- | --- | --- |
| UI | Desktop shell, Home, Search, album/artist/playlist/library, player, downloads, settings, account | Advanced social/statistics screens and richer media |
| Playback | Streaming, queue, seek, shuffle/repeat, volume, background/media controls, recovery, local files | EQ, advanced transitions, remote playback, additional device platforms |
| Downloads | Track/album/playlist jobs, progress, cancellation, retries, offline playback, storage limits | Offline Backup, advanced formats and export/sync modes |
| Cloud | Authentication, profiles, persistent personal library, cross-device sync | Managed accounts and household controls |
| Catalog | Real search, canonical metadata, recording matching, browse, basic recommendations | AI DJ/playlists, richer personalization, concert feeds |
| Social | Shareable content links and public playlist visibility | Following, collaboration, Blend, Jam, Messages |
| Lyrics | Synchronized lyrics when an authorized source supplies them | Translations, offline lyrics, visual media, song stories |
| Statistics | Reliable history and opt-in event inputs | Weekly stats, Wrapped, milestones |

## Remaining implementation decisions

- Select metadata/audio providers after a working access-and-permission spike; neither reference project guarantees access for this app.
- Freeze a dated, versioned Spotify screenshot/interaction baseline before calling the UI pixel accurate. The running Spotify UI has not been inspected in this task.
- Choose app name and release branding, deployment region, hosting budget, and supported Windows versions. Proposed baseline: Windows 11 x64.
- Approve or revise the recommended stack in 01 before generating the app scaffold.
- Decide public-release timing and whether to ship any upstream-derived code. Keep attribution and dependency licenses with any reused material.

No files here claim Spotify's catalog, private recommendation model, proprietary device protocol, or licensed media assets are available to reproduce. Equivalent behavior is planned against available providers.
