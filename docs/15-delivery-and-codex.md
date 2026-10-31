# Delivery, shared integration and Codex workflow

Owners: all four equally. No integration lead. This plan does not start development agents or create application code.

## Milestones

| Milestone | P1 | P2 | P3 | P4 | Shared exit check |
| --- | --- | --- | --- | --- | --- |
| M0: decisions/spikes | Versioned Spotify baseline, shell prototype | Packaged player + Python worker | Two-account cloud round-trip | Provider/candidate capability spike | Confirm stack, sources, schemas and fixtures |
| M1: connected slice | Search/album/playlist/player views | Streaming, seek, queue | Login, likes, playlist sync | Search, metadata, correct recording match | Search -> play -> like -> playlist -> reload |
| M2: launch requirements | Downloads/library/settings states | Persistent downloads, offline playback, media controls | Outbox/conflicts, history, profile/privacy | Browse, basic recommendations, share links | Download -> restart offline -> play; second install sees library |
| M3: release candidate | Visual/accessibility comparisons | Failure recovery and packaging | Isolation, export/deletion, migrations | Rate limits, match quality, provider outage | Clean-machine install and complete acceptance journey |
| M4+: parity | Advanced visual/social/statistics views | Advanced audio/device features | Advanced library/managed accounts | Personalization, collaboration, Blend, Jam, Messages, stats | Ship capabilities independently with their checks |

Do not set calendar promises before M0 establishes source access and packaging complexity. Rebalance after M1 using remaining estimated effort, not feature counts.

## Daily collaboration

- Each person owns vertical feature slices within their domain and connects consumers/providers themselves.
- Agree shared contract changes before implementation; require one affected teammate's review.
- Rotate release duty; it is an operational chore, not authority over architecture or other people's code.
- Merge small tested changes daily. Use feature flags for unfinished advanced features; launch requirements cannot be hidden permanently to declare completion.
- Keep one shared backlog and decision log. Record dependencies explicitly rather than assigning vague integration tickets.

## Codex use

Create a repository AGENTS.md at implementation kickoff with these ownership paths, commands, architecture decisions and fixture rules. Use separate branches/worktrees for concurrent tasks. Each task states outcome, allowed paths, contracts, acceptance criteria and checks. Avoid concurrent edits to shared schemas, lockfiles and migration numbering.

Suggested task sizes: one reusable UI component/state; one player transition; one idempotent library mutation; one provider adapter; one failure-recovery case. Humans review generated diffs and run the actual app. Do not submit large unreviewed feature batches because the generator reports success.

Example prompt:

> Implement the download cancellation slice in services/download-worker and its typed desktop adapter. Follow docs/09-downloads-and-offline.md. Cancel conversion subprocesses, preserve unrelated files and report cancelled once. Use cleared fixtures; cover worker termination and retry. Do not change the UI, auth, providers or dependency versions without explaining why. Summarize changes and checks.

## Checks and accountability

- P1: baseline comparisons, keyboard/focus, resizing and long/empty/error states.
- P2: deterministic state transitions, worker lifecycle, network/disk failures and packaged Windows playback.
- P3: database access policies, migrations, offline replay, conflicts and two-installation convergence.
- P4: metadata/matching fixtures, rate limits, recommendation exclusions and social access controls.
- Together: one scripted journey from fresh install through sign-in, search, streaming, library edits, downloads, restart offline and second-installation sync.

Keep provider tests separate from deterministic CI; a network outage is diagnosed as provider failure, not silently ignored. Use dependency locks, recorded versions and notices. No copied Spotify visual assets or upstream source enter releases without provenance. Maintain an honest feature-capability table for unavailable provider/device functions.

## Definition of launch done

All launch commitments in README work in a packaged Windows build; no podcasts, audiobooks, paid gates or app advertising; visual baseline reviewed; streaming needs no full pre-download; downloads survive restart; accounts and sync pass isolation/conflict tests; known source limits are recorded; rollback/update path is exercised. Every owner signs off on their module and one cross-module journey.
