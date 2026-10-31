# @fyspoti/contracts

**Draft. Not agreed yet.** These are P4's proposed schemas for the catalog boundary. Per [docs/15](../../docs/15-delivery-and-codex.md), each change needs review by an affected owner. Treat them as a proposal until P1, P2 and P3 have reviewed them.

This package covers `Track`, `Album`, `Artist`, `SourceCandidate`, match results, the `CatalogApi`, cursor pagination and error codes. P2's and P3's own contracts, such as `PlayableSource` and `ListeningEvent`, are left to them.

```sh
npm install
npm run check
```

## Using it

Consumers can build against the mock now:

```ts
import { CatalogFixtures, createMockCatalog } from '@fyspoti/contracts/testing';
```

`test/catalog-contract.test.ts` holds both sides of the boundary. The provider checks should also run against the real adapter in `packages/catalog`.

## Proposed changes to docs/01

| Change | Why | Reviewer |
| --- | --- | --- |
| `Track.artists` holds `{ id, name }`, not bare IDs | Lists can render without one lookup per row | P1 |
| `explicit` is `explicit`, `not-explicit` or `unknown` | MusicBrainz has no flag, and unknown differs from known-safe | P1, P3 |
| `filterExplicit` also hides `unknown` | The setting fails closed | P3 |
| `albumId` can be null | Some recordings have no known release | P1, P3 |
| `SourceCandidate` adds `id`, `accessBasis`, `license` | `DownloadJob` needs a candidate ID, and sources can be disabled by type | P2 |
| Calls return a `Result`, not exceptions | Errors survive IPC, and a rate limit cannot look like an empty list | P1, P2 |
| Adds a `CANCELLED` error code | Search cancellation is a stated requirement | P1 |
| `findCandidates` returns `no-match` as data | `NO_MATCH` stays for callers that needed a candidate | P2 |
| `getRecommendations` takes a cursor | All list APIs use cursors | P1 |

`p2/src/contracts.ts` has P2's own types. The gaps between the two are listed in [docs/16](../../docs/16-provider-spike.md#integration-with-p2s-module).

Fixtures in `tests/fixtures/catalog` are invented. Keep them that way: see the public repository rules in [docs/16](../../docs/16-provider-spike.md).
