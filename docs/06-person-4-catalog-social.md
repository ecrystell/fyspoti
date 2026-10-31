# Person 4: music discovery, social features, and listening statistics

## Goal

Help people find the right songs, discover music they may enjoy, and share music and listening experiences with others. Person 4 builds these features and connects them to the rest of the app; there is no separate integration lead.

## What Person 4 owns

- Connect the app to music information sources. Keep song, album, and artist details consistent, and help the app find the correct recording when sources describe the same music differently.
- Build music search and browsing, including charts, new releases, artist and album pages, credits, and related artists.
- Build the first versions of Home recommendations, radio, playlist suggestions, Autoplay, and Smart Shuffle.
- Later, add personalized mixes and features such as daylist, repeat mixes, release feeds, AI DJ or playlist ideas, and ways for users to give feedback on recommendations.
- Connect the app to approved sources for lyrics, music stories, concerts, venues, and merchandise. Work with Person 1 on how this information appears in the app.
- Let people open shared links and find public playlists. Private playlists must stay private.
- Later, build friends and following, including friend requests, privacy settings, and blocking; collaborative playlists; Blend; Jam group listening; Messages; and sharing listening activity.
- Summarize listening history into weekly statistics, an annual personalized Wrapped recap, and listening milestones.

## Suggested order

1. Check that one source can provide useful music details and another can help find playable versions. Coordinate with Person 2, who handles playback.
2. Give the rest of the app sample music data and working search results for songs, albums, and artists.
3. Make sure the app identifies the right recording. If it cannot tell which version is correct, show that clearly instead of guessing.
4. Build the basic browsing and recommendation features, plus links to shared playlists.
5. Add the larger discovery features, then build social features and listening statistics. The detailed plans are in docs 13 and 14.

## How the work is divided

- Person 2 handles playing music, finding playable audio, and downloads.
- Person 3 handles users' private libraries and the app's account and sign-in foundations.
- Person 4 handles social features and the data access rules they need, including who can see or change shared content.
- Person 1 provides shared visual components. Person 4 builds the screens for Person 4's features when needed.
- Person 4 should build their own feature connections; this work does not all go through Person 3 or Person 1.

## How we will know it works

- Search results remain consistent as people move through pages of results.
- The app does not mistake a live version, remix, clean version, or remaster for a different version of a song.
- When a music source limits requests, the app explains the problem and lets people recover instead of showing an unexplained empty result.
- A shared link never reveals a private playlist.
- Recommendations follow the user's explicit-content settings and respect excluded listening history and blocked artists.

## Example task

Check how well the app matches possible recordings against a small set of examples with known answers. Include remasters, covers, and live versions. Explain why each match was chosen, and clearly report when there is no good match. Do not work on playing or downloading the audio as part of this task.

References: [Catalog and discovery](13-catalog-and-discovery.md), [social and statistics](14-social-and-statistics.md), [upstream references](02-upstream-references.md).
