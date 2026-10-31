# Lyrics, visuals and music context

Owner: P1 for rendering; P4 for authorized data providers; P2 for audio/video clock and offline artifacts.

## Launch

Display synchronized lyrics where supplied, with expanded view, current-line highlighting, missing-lyrics state and seeking only where timestamps/source duration permit. Include artwork, artist context and credits through shared catalog contracts. Lyrics availability is per track; playback must work without lyrics.

## Implementation

1. P4 defines `LyricsDocument`: track/recording ID, language, plain lines, optional timed lines, provenance, permissions and revision.
2. P1 renders lyrics from P2's playback clock, compensating for recorded source offsets where known. Seeking and buffering must not create a second timer.
3. Cache only where provider rights allow; invalidate mismatched recording versions. Network failures never pause audio.
4. Add translation toggle, previews and shareable lyric cards when supported data/permissions exist.
5. P2 adds offline lyric artifacts tied to download identity; P1 shows availability accurately.
6. Add Canvas-style loops, artist Clips and music-video views behind capability flags. P4 supplies media identity; P2 synchronizes engine/position changes.
7. Add song-context/story cards with source attribution; concert/venue/merchandise presentation uses P4's feed, not hardcoded mocks.

## Later scope

Translations, offline lyrics, lyric sharing, Canvas/Clips, music videos, song-story cards, concert and merchandise surfaces remain assigned but do not block launch. Do not imply Spotify's licensed visual catalog or its original story content can be fetched freely.

## Acceptance

Test plain/timed/missing lyrics, multiple languages and long lines, seeking backward, source duration mismatch, offline cache and reduced-motion preferences. Video mode must preserve the intended recording and position or explain why it cannot. Media failures fall back to ordinary audio/artwork.

Reference: [Spotify lyrics behavior](https://newsroom.spotify.com/2026-02-04/lyric-translations-offline-previews/), [Spotube metadata/audio separation](02-upstream-references.md).
