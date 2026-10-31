# Player, audio and device plan

Owner: P2. Depends on P4 metadata/candidates, P3 settings/history and P1 controls.

## Launch behavior

Stream directly after Play; independently support local files and complete offline downloads. Implement queue, seek, previous/next, shuffle history, repeat-one/all, volume, sleep timer, background playback and Windows media controls. App-inserted advertisements are absent; do not promise provider content is ad-free unless the chosen integration actually supports that experience.

## Implementation

1. Define states: idle, resolving, buffering, playing, paused, ended and error. Download state is separate.
2. Increment a playback generation on every track change. Cancel old resolution and ignore late callbacks.
3. Prefer a complete compatible local artifact, otherwise resolve a fresh stream from a selected candidate. Respect content restrictions and source capabilities.
4. Implement ordered queue with separate user additions, context items and played history. Shuffle changes upcoming order without changing current identity; unshuffle restores predictable context order.
5. Refresh expiring sources and restore position when seekable. Bound retries; unavailable tracks show a reason and follow an explicit skip policy.
6. Persist resumable state locally. Restoring the app does not autoplay unexpectedly.
7. Register Windows media metadata/commands and handle output-device changes, sleep/resume and application quit.
8. Emit listening events by actual listened time, excluding paused/buffering intervals and handling seek/repeat.

## Advanced parity backlog

- Quality settings by connection/download, automatic quality adaptation and Data Saver.
- Normalization/loudness and EQ presets; gapless, crossfade, Automix and custom playlist transitions.
- Lossless only for genuinely lossless sources; never relabel transcoded lossy audio.
- Video engine and audio/video position transfer with P1/P4.
- Remote playback, device discovery, handoff, casting and compatible speakers/TVs/consoles/wearables.
- CarPlay/Android Auto and native mobile controls require later mobile/platform apps. Windows launch does not include them.
- Supported voice/media integrations and desktop widgets.

Spotify Connect is not a public protocol this plan assumes can be copied. Build an app-owned device/session equivalent and label supported capabilities honestly.

## Interfaces

Implement the commands and PlayerState in 01. P4 returns matching candidates; P2 returns ephemeral playable sources. Jam in 14 supplies session intent/time anchors; the engine reports actual readiness and position. The UI never supplies arbitrary filesystem paths or executable arguments.

## Acceptance

Use cleared fixtures for deterministic queue tests and a small permitted online sample for integration. Exercise rapid next/seek, HTTP expiry, no match, slow network, pause during resolve, repeat-one, shuffle back-history, headphones disconnect and sleep/resume. Measure startup and seek latency on agreed hardware; set release thresholds after the spike rather than inventing performance claims.

Reference: [Spotube architecture findings](02-upstream-references.md). Reuse its separation of music sources and player responsibilities conceptually; audit specific upstream implementations before adapting code.
