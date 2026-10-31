# Person 2: playback ownership plan

## Outcome

Reliable streaming and downloads in the packaged Windows app. A user presses Play without preparing local files.

## Owned work

- Audio engine, source resolution, buffering, retries, seek, volume, queue, repeat, shuffle and local files.
- Background playback, media/lock-screen controls, timer and Windows lifecycle behavior.
- Quality settings, data controls, normalization, EQ, gapless and advanced transitions as sequenced in 08.
- Downloader worker, jobs, progress, cancellation, retry, tagging, local artifacts and offline playback; see 09.
- Later Offline Backup, lossless-capable sources, video playback, remote handoff, casting and additional device integrations.

## Sequence

1. Spike a packaged audio engine and isolated download worker using cleared test content.
2. Implement state machine and commands before connecting UI.
3. Add streaming provider resolution and recording-safe fallbacks with P4.
4. Build persistent download jobs and offline artifact resolution for launch.
5. Add Windows media controls and failure recovery; measure agreed performance targets.
6. Add advanced audio/device parity in separate capability-gated increments.

## Handoffs

P4 owns canonical metadata and matching evidence; P2 owns extraction of a playable source and refreshing its expiry. P3 stores user preferences/history and exposes offline metadata. P1 renders commands and state. Emit deduplicated listening events, not a database write on every progress tick.

## Acceptance

- Rapid skip/seek cannot let stale requests start an earlier song.
- Queue order and repeat semantics survive expected transitions.
- Download work does not stall playback or UI.
- Restarting offline plays complete downloads and explains missing ones.
- Cancel, disk-full, worker crash and source expiry recover predictably.
- Windows installer works without a developer Python installation.

## Codex task example

Implement queue transitions behind the Player contract, using deterministic fixture tracks. Cover end-of-track, repeat-one, shuffle history, unavailable source and stale resolve cancellation. Do not implement UI or authentication.

References: [Player](08-player-and-devices.md), [downloads](09-downloads-and-offline.md), [spotDL source map](02-upstream-references.md).
