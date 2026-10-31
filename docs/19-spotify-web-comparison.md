# Person 1: live Spotify Web comparison

2026-10-31. Reference: user-owned Chrome tab at https://open.spotify.com/. Inspected Home and all time playlist without changing saved Spotify content or playback. Web measurements are web evidence, not proof of Windows desktop equivalence.

## Observed geometry at 1536 x 791

- Global header 64px.
- Left and right panels approximately 294px each; main content 916px; 8px gutters.
- Bottom player inner region 72px with surrounding spacing.
- Library rows 64px; track rows 56px, header row approximately 37px.
- Playlist table includes Title, Album, Date added and duration, with columns removed when space is limited.
- Four-column Home quick-access grid at the measured center width; two columns at narrower widths.

## Implemented improvements

- Added src/web.css with measured header, search, sidebar, track table, player and responsive sizes.
- New panel defaults of 294px and a Settings -> Reset panel sizes action. Existing local preferences are otherwise retained after the layout migration.
- Added src/web-reference.ts containing the actual observed online playlist covers and profile image. Covers for all time, rn, zorp, bambambambam, dududududu and peanuts instrumentals now replace unrelated album stand-ins. User-uploaded covers take priority.
- Profile and account avatar use the observed profile image unless locally overridden.
- Home quick-access order follows the observed selection for available local playlists; not every Spotify playlist has been imported.
- Home release uses observed Ariana Grande portrait and petal cover/title. Play explains unavailable release audio; external release action opens the observed Spotify album URL. It no longer plays an unrelated Ariana Grande preview under that artwork.
- Changed misleading personalized section title to Recently explored; recommendation service is not connected.
- Added responsive Date added column with an honest dash for unavailable dates.
- Retained no-podcast/no-audiobook scope and original Fyspoti window controls.

## Verification

TypeScript and production Vite build passed. Browser inspection found zero broken loaded artwork images. Header measured 64px and library rows 64px. Playlist rows measured 56px. Confirmed all time uses its actual cover URL. Exercised Settings layout reset and playlist navigation. Main table and new Date added column rendered. No Spotify playlist contents, likes, credentials or cookies were modified or exported.

Remaining: proprietary font differences, exact animations, real complete playlist import, genuine artist portraits/biographies, recommendations, dates and backend services. Local seeded playlists still contain the limited preview catalog; they are not represented as complete imports from Spotify.
