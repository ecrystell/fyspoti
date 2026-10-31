import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BrowseShelf, LyricsDocument, Recommendation, pageOf, resultOf } from '@fyspoti/contracts';
import {
  ProviderFailure,
  createCatalog,
  createLrclib,
  createMemoryCatalogStore,
  lyricsDocument,
  parseSyncedLyrics,
  type AlbumRow,
  type ArtistRow,
  type HomeShelfRow,
  type LyricsPort,
  type LyricsRecord,
  type TrackRow,
  type YtMusicPort,
} from '@fyspoti/catalog';

// Every name and lyric line here is invented.
const song = (overrides: Partial<TrackRow> = {}): TrackRow => ({
  videoId: 'vid-seed',
  title: 'Harbor Lights',
  videoType: 'MUSIC_VIDEO_TYPE_ATV',
  artists: [{ name: 'The Paper Lanterns', id: 'chan-1' }],
  albumName: 'Harbor Lights',
  albumId: 'alb-1',
  durationSeconds: 214,
  isExplicit: false,
  thumbnails: [],
  ...overrides,
});
const albumRow: AlbumRow = { browseId: 'MPRE-1', title: 'New Album', type: 'Album', year: '2026', artists: [{ name: 'Mira Vale', id: 'chan-2' }], isExplicit: false, thumbnails: [] };
const artistRow: ArtistRow = { browseId: 'chan-2', name: 'Mira Vale', thumbnails: [] };

const radioRows = [
  song(),
  song({ videoId: 'vid-a', title: 'Quay Song', durationSeconds: 180 }),
  song({ videoId: 'vid-b', title: 'Tin Roof', durationSeconds: 190, artists: [{ name: 'Tin Choir', id: 'chan-3' }], isExplicit: null }),
];
const shelves: HomeShelfRow[] = [
  { title: 'New releases', items: [{ kind: 'album', row: albumRow }] },
  { title: 'Featured', items: [{ kind: 'playlist', row: { playlistId: 'pl-1', title: 'Trending 20', description: 'Chart', thumbnails: [] } }] },
  // Home song rows arrive with no duration, so they cannot become tracks.
  { title: 'Quick picks', items: [{ kind: 'track', row: song({ durationSeconds: null }) }] },
];

const fakeYtMusic = (overrides: Partial<YtMusicPort> = {}): YtMusicPort => ({
  searchTracks: vi.fn(async () => [song()]),
  searchAlbums: vi.fn(async () => []),
  searchArtists: vi.fn(async () => []),
  album: vi.fn(async () => ({ ...albumRow, tracks: [] })),
  artist: vi.fn(async () => artistRow),
  relatedArtists: vi.fn(async () => [artistRow, { browseId: null, name: 'No Channel', thumbnails: [] }]),
  radio: vi.fn(async () => radioRows),
  home: vi.fn(async () => shelves),
  moods: vi.fn(async () => [{ group: 'Genres', title: 'Blues', params: 'p1' }, { group: null, title: 'Broken', params: null }]),
  moodPlaylists: vi.fn(async () => [{ playlistId: 'pl-2', title: 'Blues Hour', description: null, thumbnails: [] }]),
  playlist: vi.fn(async () => radioRows),
  suggestions: vi.fn(async () => Array.from({ length: 12 }, (_, index) => `harbor ${index}`)),
  ...overrides,
});

const record = (overrides: Partial<LyricsRecord> = {}): LyricsRecord => ({
  id: 7,
  trackName: 'Harbor Lights',
  artistName: 'The Paper Lanterns',
  duration: 214,
  instrumental: false,
  plainLyrics: 'First line\nSecond line',
  syncedLyrics: '[00:01.50] First line\n[00:04.25] Second line',
  ...overrides,
});
const lyricsPort = (found: LyricsRecord | null = record()): LyricsPort => ({ find: vi.fn(async () => found) });

const open = () => ({ filterExplicit: false, excludedTrackIds: [] as string[], blockedArtistIds: [] as string[] });
const seedOf = async (catalog: ReturnType<typeof createCatalog>) => {
  const result = await catalog.search('harbor', null);
  if (!result.ok || result.value.items[0]?.kind !== 'track') throw new Error('no track');
  return result.value.items[0].track;
};
const titles = (result: Awaited<ReturnType<ReturnType<typeof createCatalog>['getRecommendations']>>) => (result.ok ? result.value.items.map((item) => item.track.title) : result.error.code);

describe('recommendations', () => {
  it('builds a radio from a seed, without repeating it, and says why', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const seed = await seedOf(catalog);
    const result = resultOf(pageOf(Recommendation)).parse(await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, null));
    expect(result.ok && result.value.items.map((item) => item.track.title)).toEqual(['Quay Song', 'Tin Roof']);
    expect(result.ok && result.value.items[0]?.reason).toBe('Radio based on Harbor Lights');
  });

  it('gives a home seed its own reason', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const seed = await seedOf(catalog);
    const result = await catalog.getRecommendations({ surface: 'home', seedTrackId: seed.id, ...open() }, null);
    expect(result.ok && result.value.items[0]?.reason).toBe('Because you played Harbor Lights');
  });

  it('starts a new person on a popular playlist, and does not claim it is personal', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const result = await catalog.getRecommendations({ surface: 'home', ...open() }, null);
    expect(result.ok && result.value.items[0]?.reason).toBe('Popular now: Trending 20');
  });

  it('removes excluded tracks and blocked artists', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const seed = await seedOf(catalog);
    const first = await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, null);
    const [quay, tin] = first.ok ? first.value.items : [];
    const excluded = await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open(), excludedTrackIds: [quay?.track.id as string] }, null);
    expect(titles(excluded)).toEqual(['Tin Roof']);
    const blocked = await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open(), blockedArtistIds: [tin?.track.artists[0]?.id as string] }, null);
    expect(titles(blocked)).toEqual(['Quay Song']);
  });

  it('fails closed on the explicit filter', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const seed = await seedOf(catalog);
    expect(titles(await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open(), filterExplicit: true }, null))).toEqual(['Quay Song']);
  });

  it('does not let a radio row erase an explicit status it never had', async () => {
    const explicitRow = song({ videoId: 'vid-x', title: 'Static', durationSeconds: 200, isExplicit: true });
    const radioRow = { ...explicitRow, isExplicit: null };
    const ytMusic = fakeYtMusic({ searchTracks: async () => [song(), explicitRow], radio: async () => [radioRow] });
    const catalog = createCatalog({ ytMusic });
    const seed = await seedOf(catalog);
    const result = await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, null);
    expect(result.ok && result.value.items[0]?.track.explicit).toBe('explicit');
    const found = await catalog.search('harbor', null);
    const searched = found.ok ? found.value.items.flatMap((hit) => (hit.kind === 'track' ? [hit.track.id] : [])) : [];
    expect(searched).toContain(result.ok ? result.value.items[0]?.track.id : '');
  });

  it('pages without repeats', async () => {
    const rows = Array.from({ length: 45 }, (_, index) => song({ videoId: `vid-${index}`, title: `Song ${index}`, durationSeconds: 100 + index * 20 }));
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ radio: async () => rows }) });
    const seed = await seedOf(catalog);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, cursor);
      if (!page.ok) throw new Error(page.error.message);
      seen.push(...page.value.items.map((item) => item.track.id));
      cursor = page.value.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it('calls the provider once for one radio', async () => {
    const ytMusic = fakeYtMusic();
    const catalog = createCatalog({ ytMusic });
    const seed = await seedOf(catalog);
    await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, null);
    await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open(), filterExplicit: true }, null);
    expect(ytMusic.radio).toHaveBeenCalledTimes(1);
  });

  it('refuses a radio with no usable seed', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    expect(await catalog.getRecommendations({ surface: 'radio', ...open() }, null)).toMatchObject({ ok: false, error: { retryable: false } });
    expect(await catalog.getRecommendations({ surface: 'radio', seedTrackId: randomUUID(), ...open() }, null)).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it('reports a rate limit, not an empty list', async () => {
    const radio = async (): Promise<never> => {
      throw new ProviderFailure('rate-limited', 'HTTP 429');
    };
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ radio }) });
    const seed = await seedOf(catalog);
    expect(await catalog.getRecommendations({ surface: 'radio', seedTrackId: seed.id, ...open() }, null)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
  });

  it('honors cancellation', async () => {
    const result = await createCatalog({ ytMusic: fakeYtMusic() }).getRecommendations({ surface: 'home', ...open() }, null, { signal: AbortSignal.abort() });
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });
});

describe('browse', () => {
  it('returns schema-valid shelves, and leaves out any that end up empty', async () => {
    const result = await createCatalog({ ytMusic: fakeYtMusic() }).getHomeShelves(open());
    if (!result.ok) throw new Error(result.error.message);
    result.value.forEach((shelf) => BrowseShelf.parse(shelf));
    expect(result.value.map((shelf) => shelf.title)).toEqual(['New releases', 'Featured']);
  });

  it('opens an album found on a shelf', async () => {
    const ytMusic = fakeYtMusic();
    const catalog = createCatalog({ ytMusic });
    const result = await catalog.getHomeShelves(open());
    const item = result.ok ? result.value[0]?.items[0] : undefined;
    if (item?.kind !== 'album') throw new Error('no album');
    await catalog.getAlbum(item.album.id);
    expect(ytMusic.album).toHaveBeenCalledWith('MPRE-1', undefined);
  });

  it('fails closed on albums, and blocks their artists', async () => {
    const unknown: HomeShelfRow = { title: 'Unrated', items: [{ kind: 'album', row: { ...albumRow, isExplicit: null } }] };
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ home: async () => [unknown] }) });
    expect(await catalog.getHomeShelves({ ...open(), filterExplicit: true })).toEqual({ ok: true, value: [] });

    const seen = await catalog.getHomeShelves(open());
    const item = seen.ok ? seen.value[0]?.items[0] : undefined;
    if (item?.kind !== 'album') throw new Error('no album');
    expect(await catalog.getHomeShelves({ ...open(), blockedArtistIds: [item.album.artists[0]?.id as string] })).toEqual({ ok: true, value: [] });
  });

  it('goes from a mood to a playlist to its tracks', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const moods = await catalog.getMoods();
    expect(moods).toEqual({ ok: true, value: [{ ref: 'p1', title: 'Blues', group: 'Genres' }] });
    const lists = await catalog.getMoodPlaylists('p1');
    const ref = lists.ok ? lists.value[0]?.ref : undefined;
    expect(ref).toBe('pl-2');
    const tracks = await catalog.getPlaylistTracks(ref as string, open(), null);
    expect(tracks.ok && tracks.value.items).toHaveLength(3);
  });

  it('filters playlist tracks, because a playlist cannot be rated as a whole', async () => {
    const tracks = await createCatalog({ ytMusic: fakeYtMusic() }).getPlaylistTracks('pl-2', { ...open(), filterExplicit: true }, null);
    expect(tracks.ok && tracks.value.items.map((track) => track.title)).toEqual(['Harbor Lights', 'Quay Song']);
  });

  it('keeps old shelves through an outage', async () => {
    const clock = { time: 0 };
    const home = vi.fn<YtMusicPort['home']>(async () => shelves);
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ home }), now: () => clock.time });
    await catalog.getHomeShelves(open());
    clock.time = 60 * 60 * 1000;
    home.mockRejectedValue(new ProviderFailure('network', 'down'));
    const result = await catalog.getHomeShelves(open());
    expect(result.ok && result.value).toHaveLength(2);
  });

  it('reports an outage when there is nothing saved', async () => {
    const home = async (): Promise<never> => {
      throw new ProviderFailure('network', 'down');
    };
    expect(await createCatalog({ ytMusic: fakeYtMusic({ home }) }).getHomeShelves(open())).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
  });

  it('returns related artists that can then be opened', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic() });
    const seed = await seedOf(catalog);
    const related = await catalog.getRelatedArtists(seed.artists[0]?.id as string);
    if (!related.ok) throw new Error(related.error.message);
    expect(related.value.map((artist) => artist.name)).toEqual(['Mira Vale']);
    expect(await catalog.getArtist(related.value[0]?.id as string)).toMatchObject({ ok: true, value: { name: 'Mira Vale' } });
  });

  it('refuses related artists for an unknown ID', async () => {
    expect(await createCatalog({ ytMusic: fakeYtMusic() }).getRelatedArtists(randomUUID())).toMatchObject({ ok: false, error: { retryable: false } });
  });
});

describe('suggestions', () => {
  it('caps the list', async () => {
    const result = await createCatalog({ ytMusic: fakeYtMusic() }).getSuggestions('harbor');
    expect(result.ok && result.value).toHaveLength(8);
  });

  it('skips the provider for a query too short to help', async () => {
    const ytMusic = fakeYtMusic();
    expect(await createCatalog({ ytMusic }).getSuggestions(' h ')).toEqual({ ok: true, value: [] });
    expect(ytMusic.suggestions).not.toHaveBeenCalled();
  });
});

describe('lyrics', () => {
  const hint = { title: 'Harbor Lights', artistNames: ['The Paper Lanterns'], durationMs: 214_000 };

  it('returns timed lines when the length confirms the same cut', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), lyrics: lyricsPort() });
    const seed = await seedOf(catalog);
    const result = await catalog.getLyrics(seed.id);
    if (!result.ok || !result.value) throw new Error('no lyrics');
    LyricsDocument.parse(result.value);
    expect(result.value.plainLines).toEqual(['First line', 'Second line']);
    expect(result.value.timedLines).toEqual([{ startMs: 1500, text: 'First line' }, { startMs: 4250, text: 'Second line' }]);
    expect(result.value.provenance).toEqual({ provider: 'lrclib', providerId: '7' });
    expect(result.value.permissions).toEqual({ storeOnDisk: false, share: false });
  });

  it.each([
    ['a different cut', 300_000],
    ['an unknown length, as in an import', 0],
  ])('keeps the words but drops the timing for %s', async (_name, durationMs) => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), lyrics: lyricsPort() });
    const result = await catalog.getLyrics(randomUUID(), { hint: { ...hint, durationMs } });
    expect(result.ok && result.value?.timedLines).toBeNull();
    expect(result.ok && result.value?.plainLines).toHaveLength(2);
  });

  it('treats missing lyrics as a normal answer', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), lyrics: lyricsPort(null) });
    expect(await catalog.getLyrics(randomUUID(), { hint })).toEqual({ ok: true, value: null });
  });

  it('marks an instrumental', () => {
    const document = lyricsDocument(randomUUID(), record({ instrumental: true, plainLyrics: null, syncedLyrics: null }), 214_000);
    expect(document?.instrumental).toBe(true);
    expect(document?.plainLines).toEqual([]);
  });

  it('treats an empty record as no lyrics', () => {
    expect(lyricsDocument(randomUUID(), record({ plainLyrics: null, syncedLyrics: null }), 214_000)).toBeNull();
  });

  it('does not look up an instrumental or karaoke version', async () => {
    const lyrics = lyricsPort();
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: async () => [song({ title: 'Harbor Lights (Instrumental)' })] }), lyrics });
    const seed = await seedOf(catalog);
    expect(await catalog.getLyrics(seed.id)).toEqual({ ok: true, value: null });
    expect(lyrics.find).not.toHaveBeenCalled();
  });

  it('holds lyrics briefly in memory, and never puts them in saved data', async () => {
    const lyrics = lyricsPort();
    const store = createMemoryCatalogStore();
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), lyrics, store });
    const seed = await seedOf(catalog);
    await catalog.getLyrics(seed.id);
    await catalog.getLyrics(seed.id);
    expect(lyrics.find).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.snapshot())).not.toContain('First line');
  });

  it('refuses an unknown track with no hint', async () => {
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), lyrics: lyricsPort() });
    expect(await catalog.getLyrics(randomUUID())).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it('names LRCLIB when it fails', async () => {
    const lyrics: LyricsPort = {
      find: async () => {
        throw new ProviderFailure('network', 'HTTP 503');
      },
    };
    const result = await createCatalog({ ytMusic: fakeYtMusic(), lyrics }).getLyrics(randomUUID(), { hint });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true, provider: 'lrclib' } });
  });
});

describe('LRCLIB client', () => {
  const reply = (status: number, body: unknown = null) => new Response(status === 404 ? null : JSON.stringify(body), { status });
  const request = { title: 'Harbor Lights - 2004 Remaster', artist: 'The Paper Lanterns', durationMs: 214_000 };

  it('identifies itself by the repository, not a person', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, record()));
    await createLrclib(fetchImpl).find(request);
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('github.com/ecrystell/fyspoti');
  });

  it('falls back to a search using the plain title', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => (String(url).includes('/get?') ? reply(404) : reply(200, [record({ id: 1, duration: 300 }), record({ id: 2, duration: 214 })])));
    const found = await createLrclib(fetchImpl).find(request);
    expect(found?.id).toBe(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('track_name=harbor+lights&');
  });

  it('skips the exact lookup when the length is unknown', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, [record()]));
    await createLrclib(fetchImpl).find({ ...request, durationMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/search?');
  });

  it('ignores a search result for another artist or song', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => (String(url).includes('/get?') ? reply(404) : reply(200, [record({ artistName: 'Mira Vale' }), record({ trackName: 'Quay Song' })])));
    expect(await createLrclib(fetchImpl).find(request)).toBeNull();
  });

  it.each([
    [429, 'rate-limited'],
    [503, 'network'],
  ])('reports HTTP %i as %s', async (status, kind) => {
    await expect(createLrclib(async () => reply(status, { message: 'no' })).find(request)).rejects.toMatchObject({ kind });
  });

  it('reports a dropped connection as a network failure', async () => {
    await expect(createLrclib(async () => { throw new TypeError('fetch failed'); }).find(request)).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports a cancelled request as cancelled', async () => {
    const fetchImpl: typeof fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    await expect(createLrclib(fetchImpl).find(request, AbortSignal.abort())).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('parseSyncedLyrics', () => {
  it('reads times, sorted, keeping gaps', () => {
    expect(parseSyncedLyrics('[00:10.00] Later\n[00:02.5] Early\n[00:05.00]')).toEqual([
      { startMs: 2500, text: 'Early' },
      { startMs: 5000, text: '' },
      { startMs: 10000, text: 'Later' },
    ]);
  });

  it('expands a line that repeats', () => {
    expect(parseSyncedLyrics('[00:01.00][00:03.00] Chorus')).toEqual([{ startMs: 1000, text: 'Chorus' }, { startMs: 3000, text: 'Chorus' }]);
  });

  it('applies an offset, and never goes below zero', () => {
    expect(parseSyncedLyrics('[offset:-500]\n[00:00.10] A\n[00:02.00] B')).toEqual([{ startMs: 0, text: 'A' }, { startMs: 1500, text: 'B' }]);
  });

  it('skips lines with no time', () => {
    expect(parseSyncedLyrics('[ar:Someone]\nno stamp\n[00:01.00] Real')).toEqual([{ startMs: 1000, text: 'Real' }]);
  });
});
