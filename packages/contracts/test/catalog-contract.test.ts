import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import {
  AppError,
  MatchResult,
  Recommendation,
  SearchHit,
  SourceCandidate,
  Track,
  pageOf,
  resultOf,
} from '../src/index.ts';
import type { CatalogApi, RecommendationContext } from '../src/index.ts';
import { CatalogFixtures, RATE_LIMITED_QUERY, createMockCatalog } from '../src/testing/mock-catalog.ts';

const raw = await readFile(new URL('../../../tests/fixtures/catalog/catalog.json', import.meta.url), 'utf8');
const fixtures = CatalogFixtures.parse(JSON.parse(raw));
const catalog: CatalogApi = createMockCatalog(fixtures);

// Synthetic IDs from tests/fixtures/catalog/catalog.json.
const ids = {
  tinChoir: '00000000-0000-4000-8000-000000001003',
  harborStudio: '00000000-0000-4000-8000-000000003001',
  harborRemaster: '00000000-0000-4000-8000-000000003002',
  harborLive: '00000000-0000-4000-8000-000000003003',
  harborCover: '00000000-0000-4000-8000-000000003004',
  staticExplicit: '00000000-0000-4000-8000-000000003005',
  staticClean: '00000000-0000-4000-8000-000000003006',
  unknownTrack: '00000000-0000-4000-8000-000000003999',
  studioCandidate: '00000000-0000-4000-8000-000000004001',
};

const baseContext: RecommendationContext = { surface: 'home', filterExplicit: false, excludedTrackIds: [], blockedArtistIds: [] };

const recommendedIds = async (context: RecommendationContext) => {
  const result = await catalog.getRecommendations(context, null);
  assert.ok(result.ok);
  const page = pageOf(Recommendation).parse(result.value);
  const rest = page.nextCursor ? await catalog.getRecommendations(context, page.nextCursor) : null;
  return [...page.items, ...(rest?.ok ? rest.value.items : [])].map((item) => item.track.id);
};

// Provider side: every CatalogApi implementation has to satisfy these. Real adapters
// from packages/catalog should run the same checks against recorded responses.
describe('catalog provider contract', () => {
  it('returns schema-valid search pages with no duplicates across cursors', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await catalog.search('harbor', cursor);
      const parsed = resultOf(pageOf(SearchHit)).parse(result);
      assert.ok(parsed.ok);
      for (const hit of parsed.value.items) {
        seen.push(hit.kind === 'track' ? hit.track.id : hit.kind === 'album' ? hit.album.id : hit.artist.id);
      }
      cursor = parsed.value.nextCursor;
    } while (cursor);
    assert.ok(seen.length > 2, 'the query must span more than one page');
    assert.equal(new Set(seen).size, seen.length);
  });

  it('keeps each recording version as its own track', async () => {
    const result = await catalog.search('harbor lights', null);
    assert.ok(result.ok);
    const studio = await catalog.getTrack(ids.harborStudio);
    const cover = await catalog.getTrack(ids.harborCover);
    assert.ok(studio.ok && cover.ok);
    assert.equal(studio.value.title, cover.value.title);
    assert.notEqual(studio.value.id, cover.value.id);
    assert.deepEqual(cover.value.versionFlags, ['cover']);
  });

  it('reports rate limits as a recoverable error rather than an empty page', async () => {
    const result = await catalog.search(RATE_LIMITED_QUERY, null);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    const error = AppError.parse(result.error);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryable, true);
    assert.ok((error.retryAfterMs ?? 0) > 0);
  });

  it('honors cancellation', async () => {
    const result = await catalog.search('harbor', null, { signal: AbortSignal.abort() });
    assert.ok(!result.ok);
    assert.equal(result.error.code, 'CANCELLED');
  });

  it('returns a typed error for unknown ids', async () => {
    const result = await catalog.getTrack(ids.unknownTrack);
    assert.ok(!result.ok);
    assert.equal(result.error.code, 'UNAVAILABLE');
    assert.equal(result.error.retryable, false);
  });

  it('returns each match outcome with evidence', async () => {
    const outcomes = await Promise.all(
      [ids.harborStudio, ids.harborRemaster, ids.harborLive, ids.staticClean].map(async (id) => {
        const result = await catalog.findCandidates(id);
        assert.ok(result.ok);
        return MatchResult.parse(result.value).status;
      }),
    );
    assert.deepEqual(outcomes, ['matched', 'ambiguous', 'no-match', 'no-match']);
  });

  it('applies recommendation exclusions and blocked artists', async () => {
    assert.deepEqual(await recommendedIds({ ...baseContext, excludedTrackIds: [ids.harborStudio] }), [ids.harborLive, ids.staticExplicit, ids.staticClean]);
    assert.deepEqual(await recommendedIds({ ...baseContext, blockedArtistIds: [ids.tinChoir] }), [ids.harborStudio, ids.harborLive]);
  });

  it('fails closed when filtering explicit content', async () => {
    assert.deepEqual(await recommendedIds({ ...baseContext, filterExplicit: true }), [ids.harborStudio, ids.staticClean]);
  });
});

describe('schema guards', () => {
  const track = fixtures.tracks[0];
  const candidate = fixtures.matches.flatMap((match) => (match.status === 'matched' ? [match.accepted] : []))[0];

  it('rejects an ID that is not a UUID, because P3 stores them in uuid columns', () => {
    assert.equal(Track.safeParse({ ...track, id: 'track-harbor-studio' }).success, false);
  });

  it('rejects a stream URL on Track and SourceCandidate', () => {
    assert.equal(Track.safeParse({ ...track, streamUrl: 'https://example.com/a.m4a' }).success, false);
    assert.equal(SourceCandidate.safeParse({ ...candidate, uri: 'https://example.com/a.m4a' }).success, false);
  });

  it('rejects non-https artwork', () => {
    assert.equal(Track.safeParse({ ...track, artwork: [{ url: 'file:///C:/secrets.png' }] }).success, false);
    assert.equal(Track.safeParse({ ...track, artwork: [{ url: 'http://example.com/a.jpg' }] }).success, false);
  });

  it('rejects an ambiguous result with a single candidate', () => {
    const reasons = [{ signal: 'duration-match', detail: 'Only one' }];
    assert.equal(MatchResult.safeParse({ status: 'ambiguous', trackId: ids.harborStudio, candidates: [candidate], reasons }).success, false);
  });

  it('rejects a candidate with no evidence or an out-of-range confidence', () => {
    assert.equal(SourceCandidate.safeParse({ ...candidate, evidence: [] }).success, false);
    assert.equal(SourceCandidate.safeParse({ ...candidate, confidence: 1.2 }).success, false);
  });

  it('rejects a rate limit marked as not retryable', () => {
    assert.equal(AppError.safeParse({ code: 'RATE_LIMITED', message: 'Slow down', retryable: false }).success, false);
  });
});

// Consumer side: how P2 is expected to use the boundary. It must play only an
// accepted candidate and never guess when the catalog says it cannot tell.
describe('playback consumer of findCandidates', () => {
  const chooseCandidate = async (api: CatalogApi, trackId: string) => {
    const result = await api.findCandidates(trackId);
    if (!result.ok) return { action: 'show-error' as const, code: result.error.code };
    const match = result.value;
    if (match.status === 'matched') return { action: 'resolve' as const, candidateId: match.accepted.id };
    if (match.status === 'ambiguous') return { action: 'ask-user' as const, options: match.candidates.length };
    return { action: 'show-unavailable' as const, reasons: match.reasons.length };
  };

  it('resolves only an accepted candidate', async () => {
    assert.deepEqual(await chooseCandidate(catalog, ids.harborStudio), { action: 'resolve', candidateId: ids.studioCandidate });
  });

  it('asks instead of guessing on an ambiguous match', async () => {
    assert.deepEqual(await chooseCandidate(catalog, ids.harborRemaster), { action: 'ask-user', options: 2 });
  });

  it('explains a no-match instead of substituting another version', async () => {
    assert.deepEqual(await chooseCandidate(catalog, ids.harborLive), { action: 'show-unavailable', reasons: 1 });
  });

  it('surfaces catalog failures', async () => {
    assert.deepEqual(await chooseCandidate(catalog, ids.unknownTrack), { action: 'show-error', code: 'UNAVAILABLE' });
  });
});
