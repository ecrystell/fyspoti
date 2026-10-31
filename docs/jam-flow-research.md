# Jam flow research and implementation outline

## Evidence and limits

This is a behavior summary based on Spotify's public support instructions and newsroom description, checked on 2026-10-31. The Spotify desktop app was not open in the available computer session, and REA was not connected, so the UI details below have not been visually inspected. Spotify's public instructions do not specify loading, empty, or most error screens. Those states are recommendations for our app, not claims about Spotify's UI.

Sources: [Spotify Support: Start or join a Jam](https://support.spotify.com/us/article/jam/), [Spotify Newsroom: Jam and collaborative listening](https://newsroom.spotify.com/2023-09-26/spotify-jam-personalized-collaborative-listening-session-free-premium-users/), and [Spotify Newsroom: Request to Jam in Messages](https://newsroom.spotify.com/2026-01-07/listening-activity-request-to-jam-messages-updates/).

## Publicly documented flow

### Start a Jam on desktop

1. Open the three-dot menu for a track or playlist, or right-click it.
2. Choose **Start a Jam**. Spotify says a Premium account is needed to host.
3. Choose **Invite**.
4. Share the invitation link or QR code.

### Join a Jam

1. Open the host's invitation link or scan the QR code.
2. Choose remote listening or listening together in person.
3. Choose **Join**.
4. Add songs to the shared queue or choose from recommendations.

Spotify says remote joining requires Premium. Free users can join a Premium host in person and add tracks.

### Manage an active Jam

- The host can invite more people and remove participants.
- The host can let guests control playback or limit them to adding songs.
- Shared volume control can be enabled where the playback device supports it.
- If the host leaves, the Jam ends for everyone.
- Spotify recommends checking the Premium subscription and selected speaker if hosting fails; for joining, check that the invitation was accepted and the correct speaker is selected.

## Suggested states for our app

These are our own design recommendations; Spotify's public help page does not document these exact screens.

| State | What our app should show |
| --- | --- |
| No session | A clear **Start a group session** action from a track, playlist, or player. |
| Starting | A short progress state while the session is created; prevent duplicate start requests. |
| Waiting for people | Host name, invite link/QR, participant count, and a clear cancel/end action. |
| Joining | Show the selected listening mode and the action in progress. Keep the invite context if joining fails. |
| Active, empty queue | Explain that nobody has added the next song yet and offer **Add songs** and search. |
| Active | Show who is present, who added each queued item, the shared queue, playback status, and host controls. |
| Invite invalid or session ended | Explain that the invite is no longer usable and offer to return or start a new session. |
| Permission or account restriction | State which capability is unavailable and why; do not silently start a different kind of session. |
| Network or service failure | Keep the session context where possible, offer retry, and avoid duplicating queue changes. |
| Unsupported shared volume | Explain that volume is controlled on the playback device, while keeping other session controls available. |

## Original implementation outline for our app

- P4 owns group-session membership, invites, shared queue operations, permissions, and server-side session events. P2 owns playback and local source resolution. P1 builds the screens. P3 supplies account identity and authorization primitives.
- Create an app-owned session with a host, participant roles, an invite token, a shared queue, and explicit playback-control settings. Do not reuse Spotify's private protocol or invitation tokens.
- Give every queue operation an ID and a server-assigned sequence number so retries and reconnects do not duplicate or reorder edits.
- Treat the host's playback state as the shared timeline. Each participant resolves the same track through their own permitted source; the host does not send audio to other participants.
- On reconnect, fetch a current session snapshot before accepting new operations. If a participant cannot resolve a track, show that to them and let the session continue for others.
- Keep the first version small: create session, invite by link, join, add/remove/reorder queue items, leave/end session, and recover from disconnects. Add QR and richer recommendations only after the basic flow works.

This outline follows the existing [social and statistics plan](14-social-and-statistics.md), which assigns group sessions to P4 and calls for a server-authoritative queue, reconnect snapshots, bounded playback drift correction, and local source resolution.
