import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MatchResult, SearchHit, pageOf, resultOf } from '@fyspoti/contracts';
import { ProviderFailure, createCatalog, recordingId, type AlbumRow, type ArtistRow, type TrackRow, type YtMusicPort } from '@fyspoti/catalog';

// The real adapter held to the provider contract in
// packages/contracts/test/catalog-contract.test.ts. Rows are invented.
const song = (overrides: Partial<TrackRow> = {}): TrackRow => ({
  videoId: 'vid-studio',
  title: 'Harbor Lights',
  videoType: 'MUSIC_VIDEO_TYPE_ATV',
  artists: [{ name: 'The Paper Lanterns', id: 'chan-1' }],
  albumName: 'Harbor Lights',
  albumId: 'alb-1',
  durationSeconds: 214,
  isExplicit: false,
  thumbnails: [{ url: 'https://example.com/a.jpg', width: 60, height: 60 }, { url: 'http://example.com/insecure.jpg', width: 60, height: 60 }],
  ...overrides,
});
const albumRow: AlbumRow = { browseId: 'alb-1', title: 'Harbor Lights', type: 'Album', year: '1998', artists: [{ name: 'The Paper Lanterns', id: 'chan-1' }], thumbnails: [] };
const artistRow: ArtistRow = { browseId: 'chan-1', name: 'The Paper Lanterns', thumbnails: [] };

const fakeYtMusic = (overrides: Partial<YtMusicPort> = {}): YtMusicPort => ({
  searchTracks: vi.fn(async (_query, filter) => (filter === 'songs' ? [song(), song({ videoId: 'vid-live', title: 'Harbor Lights (Live)', albumId: null, albumName: null, durationSeconds: 301 })] : [])),
  searchAlbums: vi.fn(async () => [albumRow]),
  searchArtists: vi.fn(async () => [artistRow]),
  album: vi.fn(async () => ({ ...albumRow, tracks: [song(), song({ videoId: 'vid-2', title: 'Quay Song', durationSeconds: 180 })] })),
  artist: vi.fn(async () => artistRow),
  ...overrides,
});

const manySongs = (count: number): TrackRow[] => Array.from({ length: count }, (_, index) => song({ videoId: `vid-${index}`, title: `Song ${index}`, durationSeconds: 100 + index * 20 }));

describe('catalog provider contract', () => {
  it('returns schema-valid pages with no repeats across cursors', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => manySongs(45) }) });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = resultOf(pageOf(SearchHit)).parse(await catalog.search('harbor', cursor));
      if (!result.ok) throw new Error(result.error.message);
      seen.push(...result.value.items.map((hit) => (hit.kind === 'track' ? hit.track.id : hit.kind === 'album' ? hit.album.id : hit.artist.id)));
      cursor = result.value.nextCursor;
    } while (cursor);
    expect(seen.length).toBe(47);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('puts every kind of result on the first page, with songs first', async () => {
    const albums = Array.from({ length: 8 }, (_, index) => ({ ...albumRow, browseId: `alb-${index}` }));
    const artists = Array.from({ length: 5 }, (_, index) => ({ ...artistRow, browseId: `chan-${index}` }));
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => manySongs(45), searchAlbums: async () => albums, searchArtists: async () => artists }) });
    const result = await catalog.search('harbor', null);
    if (!result.ok) throw new Error(result.error.message);
    const kinds = result.value.items.map((hit) => hit.kind);
    expect(kinds).toHaveLength(20);
    expect(kinds.slice(0, 14)).toEqual(Array(14).fill('track'));
    expect(kinds.filter((kind) => kind === 'album')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'artist')).toHaveLength(2);
  });

  it('asks the provider once for one query, so a page stays stable', async () => {
    const ytMusic = fakeYtMusic({ searchTracks: vi.fn(async () => manySongs(45)) });
    const catalog = createCatalog({ ytMusic });
    const first = await catalog.search('harbor', null);
    if (!first.ok) throw new Error(first.error.message);
    await catalog.search('harbor', first.value.nextCursor);
    expect(ytMusic.searchTracks).toHaveBeenCalledTimes(1);
  });

  it('asks again once a held search expires', async () => {
    let time = 0;
    const ytMusic = fakeYtMusic();
    const catalog = createCatalog({ ytMusic, now: () => time });
    await catalog.search('harbor', null);
    time = 6 * 60 * 1000;
    await catalog.search('harbor', null);
    expect(ytMusic.searchTracks).toHaveBeenCalledTimes(2);
  });

  it('shows one release of a recording once', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => [song(), song({ videoId: 'vid-reissue', albumId: 'alb-2' })] }) });
    const result = await catalog.search('harbor', null);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.items.filter((hit) => hit.kind === 'track')).toHaveLength(1);
  });

  it('keeps each recording version as its own track', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const result = await catalog.search('harbor', null);
    if (!result.ok) throw new Error(result.error.message);
    const tracks = result.value.items.flatMap((hit) => (hit.kind === 'track' ? [hit.track] : []));
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.id).not.toBe(tracks[1]?.id);
    expect(tracks[1]?.versionFlags).toEqual(['live']);
  });

  it('drops insecure artwork and rows that cannot become a track', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => [song(), song({ videoId: null }), song({ durationSeconds: null }), song({ artists: [] })] }) });
    const result = await catalog.search('harbor', null);
    if (!result.ok) throw new Error(result.error.message);
    const tracks = result.value.items.flatMap((hit) => (hit.kind === 'track' ? [hit.track] : []));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.artwork).toEqual([{ url: 'https://example.com/a.jpg', widthPx: 60, heightPx: 60 }]);
  });

  it('reports rate limits as a recoverable error rather than an empty page', async () => {
    const limited = async (): Promise<never> => {
      throw new ProviderFailure('rate-limited', 'HTTP 429');
    };
    const result = await createCatalog({ ytMusic: fakeYtMusic({ searchTracks: limited }) }).search('harbor', null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true, provider: 'youtube-music' });
    expect(result.error.retryAfterMs).toBeGreaterThan(0);
  });

  it('reports an outage as retryable and never as no results', async () => {
    const down = async (): Promise<never> => {
      throw new ProviderFailure('network', 'timed out');
    };
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: down }) });
    expect(await catalog.search('harbor', null)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
    const match = await catalog.findCandidates(randomUUID(), { hint: { title: 'Harbor Lights', artistNames: ['The Paper Lanterns'], durationMs: 0 } });
    expect(match).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
  });

  it('still returns songs when the album or artist shelf fails', async () => {
    const down = async (): Promise<never> => {
      throw new ProviderFailure('provider', 'parser failed');
    };
    const result = await createCatalog({ ytMusic: fakeYtMusic({ searchAlbums: down, searchArtists: down }) }).search('harbor', null);
    expect(result.ok && result.value.items.map((hit) => hit.kind)).toEqual(['track', 'track']);
  });

  it('honors cancellation', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const options = { signal: AbortSignal.abort() };
    expect(await catalog.search('harbor', null, options)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await catalog.getTrack(randomUUID(), options)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(await catalog.findCandidates(randomUUID(), options)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('passes a cancellation from the provider through a best-effort shelf', async () => {
    const cancelled = async (): Promise<never> => {
      throw new ProviderFailure('cancelled', 'stopped');
    };
    const result = await createCatalog({ ytMusic: fakeYtMusic({ searchAlbums: cancelled }) }).search('harbor', null);
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('returns a typed error for unknown ids', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    for (const result of [await catalog.getTrack(randomUUID()), await catalog.getAlbum(randomUUID()), await catalog.getArtist(randomUUID()), await catalog.findCandidates(randomUUID())]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: false } });
    }
  });

  it('rejects a cursor from another search rather than serving the wrong page', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => manySongs(45) }) });
    const first = await catalog.search('harbor', null);
    if (!first.ok) throw new Error(first.error.message);
    expect(await catalog.search('quay', first.value.nextCursor)).toMatchObject({ ok: false, error: { retryable: false } });
    expect(await catalog.search('harbor', 'not a cursor')).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it('returns an empty page for a blank query without asking the provider', async () => {
    const ytMusic = fakeYtMusic();
    expect(await createCatalog({ ytMusic }).search('   ', null)).toEqual({ ok: true, value: { items: [], nextCursor: null } });
    expect(ytMusic.searchTracks).not.toHaveBeenCalled();
  });

  it('says recommendations are missing rather than returning nothing', async () => {
    const result = await createCatalog({ ytMusic: fakeYtMusic() }).getRecommendations({ surface: 'home', filterExplicit: false, excludedTrackIds: [], blockedArtistIds: [] }, null);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
});

describe('moving through the catalog', () => {
  const firstTrack = async (catalog: ReturnType<typeof createCatalog>) => {
    const result = await catalog.search('harbor', null);
    if (!result.ok) throw new Error(result.error.message);
    const hit = result.value.items.find((item) => item.kind === 'track');
    if (hit?.kind !== 'track') throw new Error('no track');
    return hit.track;
  };

  it('opens a searched track, its album and its artist', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const track = await firstTrack(catalog);
    expect(await catalog.getTrack(track.id)).toMatchObject({ ok: true, value: { id: track.id } });

    const album = await catalog.getAlbum(track.albumId as string);
    expect(album).toMatchObject({ ok: true, value: { title: 'Harbor Lights', kind: 'album', releaseDate: '1998' } });
    expect(album.ok && album.value.trackIds).toHaveLength(2);
    expect(album.ok && album.value.trackIds).toContain(track.id);

    expect(await catalog.getArtist(track.artists[0]?.id as string)).toMatchObject({ ok: true, value: { name: 'The Paper Lanterns' } });
  });

  it('fetches an album once', async () => {
    const ytMusic = fakeYtMusic();
    const catalog = createCatalog({ ytMusic });
    const track = await firstTrack(catalog);
    await catalog.getAlbum(track.albumId as string);
    await catalog.getAlbum(track.albumId as string);
    expect(ytMusic.album).toHaveBeenCalledTimes(1);
  });
});

describe('findCandidates', () => {
  const hint = { title: 'Harbor Lights', artistNames: ['The Paper Lanterns'], durationMs: 214_000 };
  const parse = (result: Awaited<ReturnType<ReturnType<typeof createCatalog>['findCandidates']>>) => {
    if (!result.ok) throw new Error(result.error.message);
    return MatchResult.parse(result.value);
  };

  it('returns the exact source of a searched track without searching again', async () => {
    const ytMusic = fakeYtMusic();
    const catalog = createCatalog({ ytMusic });
    const found = await catalog.search('harbor', null);
    if (!found.ok || found.value.items[0]?.kind !== 'track') throw new Error('no track');
    const { track } = found.value.items[0];
    vi.mocked(ytMusic.searchTracks).mockClear();

    const match = parse(await catalog.findCandidates(track.id));
    expect(match.status === 'matched' && match.accepted.sourceId).toBe('vid-studio');
    expect(match.status === 'matched' && match.accepted.accessBasis).toBe('unofficial-extraction');
    expect(ytMusic.searchTracks).not.toHaveBeenCalled();
  });

  it('matches an imported or synced track from its snapshot', async () => {
    const match = parse(await createCatalog({ ytMusic: fakeYtMusic() }).findCandidates(randomUUID(), { hint }));
    expect(match.status === 'matched' && match.accepted.sourceId).toBe('vid-studio');
  });

  it('keeps the caller\'s ID, so a provisional track stays the same row', async () => {
    const trackId = randomUUID();
    const match = parse(await createCatalog({ ytMusic: fakeYtMusic() }).findCandidates(trackId, { hint }));
    expect(match.trackId).toBe(trackId);
    expect(match.status === 'matched' && match.accepted.trackId).toBe(trackId);
  });

  it('gives the same answer on a second install, which starts knowing nothing', async () => {
    const id = await recordingId({ title: 'Harbor Lights', primaryArtist: 'The Paper Lanterns', durationMs: 214_000, explicit: 'not-explicit', versionFlags: [] });
    const firstInstall = createCatalog({ ytMusic: fakeYtMusic() });
    const found = await firstInstall.search('harbor', null);
    expect(found.ok && found.value.items[0]?.kind === 'track' && found.value.items[0].track.id).toBe(id);
    const match = parse(await createCatalog({ ytMusic: fakeYtMusic() }).findCandidates(id, { hint }));
    expect(match.status === 'matched' && match.accepted.sourceId).toBe('vid-studio');
  });

  it('skips the video shelf once the song shelf settles it', async () => {
    const ytMusic = fakeYtMusic();
    await createCatalog({ ytMusic }).findCandidates(randomUUID(), { hint });
    expect(vi.mocked(ytMusic.searchTracks).mock.calls.map((call) => call[1])).toEqual(['songs']);
  });

  it('checks the video shelf when the song shelf only has a loose fit', async () => {
    const ytMusic = fakeYtMusic({
      searchTracks: vi.fn(async (_query, filter) => (filter === 'songs' ? [song({ videoId: 'loose', durationSeconds: 222 })] : [song({ videoId: 'exact', albumName: null, albumId: null })])),
    });
    const match = parse(await createCatalog({ ytMusic }).findCandidates(randomUUID(), { hint }));
    expect(match.status === 'matched' && match.accepted.sourceId).toBe('exact');
  });

  it('explains a no-match instead of substituting another version', async () => {
    const live = { ...hint, title: 'Harbor Lights (Live at the Quay)', durationMs: 0 };
    const ytMusic = fakeYtMusic({ searchTracks: async () => [song()] });
    const match = parse(await createCatalog({ ytMusic }).findCandidates(randomUUID(), { hint: live }));
    expect(match.status).toBe('no-match');
    expect(match.status === 'no-match' && match.reasons.length).toBeGreaterThan(0);
  });

  it('lets a correction accept a source the score would not choose', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const trackId = randomUUID();
    catalog.setMatchOverride(trackId, { acceptSourceId: 'vid-live' });
    const match = parse(await catalog.findCandidates(trackId, { hint }));
    expect(match.status === 'matched' && match.accepted.sourceId).toBe('vid-live');
    expect(match.status === 'matched' && match.accepted.evidence[0]?.signal).toBe('manual-override');
  });

  it('lets a correction rule a source out', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const trackId = randomUUID();
    catalog.setMatchOverride(trackId, { rejectSourceIds: ['vid-studio'] });
    expect(parse(await catalog.findCandidates(trackId, { hint })).status).toBe('no-match');
  });
});
