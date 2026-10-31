import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderFailure, createCatalog, createMemoryCatalogStore, type AlbumRow, type ArtistRow, type TrackRow, type YtMusicPort } from '@fyspoti/catalog';
import { openFileCatalogStore } from '@fyspoti/catalog/file-store';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// All rows are invented.
const song = (overrides: Partial<TrackRow> = {}): TrackRow => ({
  videoId: 'vid-studio',
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
const albumRow: AlbumRow = { browseId: 'alb-1', title: 'Harbor Lights', type: 'Album', year: '1998', artists: [{ name: 'The Paper Lanterns', id: 'chan-1' }], thumbnails: [] };
const artistRow: ArtistRow = { browseId: 'chan-1', name: 'The Paper Lanterns', thumbnails: [] };

const fakeYtMusic = (overrides: Partial<YtMusicPort> = {}): YtMusicPort => ({
  searchTracks: vi.fn(async () => [song()]),
  searchAlbums: vi.fn(async () => [albumRow]),
  searchArtists: vi.fn(async () => [artistRow]),
  album: vi.fn(async () => ({ ...albumRow, tracks: [song()] })),
  artist: vi.fn(async () => artistRow),
  ...overrides,
});

const failing = (kind: ProviderFailure['kind']) => async (): Promise<never> => {
  throw new ProviderFailure(kind, kind);
};

const hint = { title: 'Harbor Lights', artistNames: ['The Paper Lanterns'], durationMs: 214_000 };

const firstTrack = async (catalog: ReturnType<typeof createCatalog>) => {
  const result = await catalog.search('harbor', null);
  if (!result.ok || result.value.items[0]?.kind !== 'track') throw new Error('no track');
  return result.value.items[0].track;
};

describe('saved catalog', () => {
  let folder: string;
  let path: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'fyspoti-catalog-'));
    path = join(folder, 'nested', 'catalog.json');
  });
  afterEach(() => rm(folder, { recursive: true, force: true }));

  it('finds a track, its album and its artist after a restart, with no provider call', async () => {
    const before = await openFileCatalogStore({ path });
    const firstRun = createCatalog({ ytMusic: fakeYtMusic(), store: before });
    const track = await firstTrack(firstRun);
    await firstRun.getAlbum(track.albumId as string);
    await firstRun.getArtist(track.artists[0]?.id as string);
    await before.flush();

    const ytMusic = fakeYtMusic();
    const restarted = createCatalog({ ytMusic, store: await openFileCatalogStore({ path }) });
    expect(await restarted.getTrack(track.id)).toMatchObject({ ok: true, value: { title: 'Harbor Lights' } });
    expect(await restarted.getAlbum(track.albumId as string)).toMatchObject({ ok: true, value: { trackIds: [track.id] } });
    expect(await restarted.getArtist(track.artists[0]?.id as string)).toMatchObject({ ok: true, value: { name: 'The Paper Lanterns' } });
    expect(await restarted.findCandidates(track.id)).toMatchObject({ ok: true, value: { status: 'matched', accepted: { sourceId: 'vid-studio' } } });
    expect(ytMusic.searchTracks).not.toHaveBeenCalled();
    expect(ytMusic.album).not.toHaveBeenCalled();
    expect(ytMusic.artist).not.toHaveBeenCalled();
  });

  it('keeps an album reachable after a restart when only its search row was seen', async () => {
    const before = await openFileCatalogStore({ path });
    const track = await firstTrack(createCatalog({ ytMusic: fakeYtMusic(), store: before }));
    await before.flush();
    const restarted = createCatalog({ ytMusic: fakeYtMusic(), store: await openFileCatalogStore({ path }) });
    expect(await restarted.getAlbum(track.albumId as string)).toMatchObject({ ok: true });
  });

  it('keeps a saved match and a correction', async () => {
    const before = await openFileCatalogStore({ path });
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), store: before });
    const matched = randomUUID();
    const corrected = randomUUID();
    await catalog.findCandidates(matched, { hint });
    catalog.setMatchOverride(corrected, { rejectSourceIds: ['vid-studio'] });
    await before.flush();

    const after = await openFileCatalogStore({ path });
    expect(after.getMatch(matched)?.match.status).toBe('matched');
    expect(after.getOverride(corrected)).toEqual({ rejectSourceIds: ['vid-studio'] });
  });

  it('starts empty on first run', async () => {
    const store = await openFileCatalogStore({ path });
    expect(store.getTrack(randomUUID())).toBeUndefined();
  });

  it.each([
    ['damaged', '{"version":1,"tracks":['],
    ['from a newer app', '{"version":99}'],
  ])('sets aside a file that is %s, because it may hold corrections', async (_name, text) => {
    const file = join(folder, 'catalog.json');
    await writeFile(file, text);
    const store = await openFileCatalogStore({ path: file });
    expect(store.getTrack(randomUUID())).toBeUndefined();
    expect(await readFile(`${file}.unreadable`, 'utf8')).toBe(text);
  });

  it('drops one unreadable record and keeps the rest', async () => {
    const before = await openFileCatalogStore({ path });
    const track = await firstTrack(createCatalog({ ytMusic: fakeYtMusic(), store: before }));
    await before.flush();
    const saved = JSON.parse(await readFile(path, 'utf8')) as { tracks: unknown[] };
    saved.tracks.push({ id: 'bad', value: { streamUrl: 'https://example.com/a.m4a' }, savedAt: 1 });
    await writeFile(path, JSON.stringify(saved));

    const after = await openFileCatalogStore({ path });
    expect(after.getTrack(track.id)?.title).toBe('Harbor Lights');
    expect(after.getTrack('bad')).toBeUndefined();
  });

  it('collects changes and saves them shortly after', async () => {
    const store = await openFileCatalogStore({ path, saveDelayMs: 10 });
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), store });
    await firstTrack(catalog);
    await vi.waitFor(async () => expect(JSON.parse(await readFile(path, 'utf8')).tracks).toHaveLength(1));
  });

  it('leaves only the finished file behind', async () => {
    const store = await openFileCatalogStore({ path });
    await firstTrack(createCatalog({ ytMusic: fakeYtMusic(), store }));
    await store.flush();
    expect(await readdir(join(folder, 'nested'))).toEqual(['catalog.json']);
  });

  it('keeps working and retries when a save fails', async () => {
    const blocked = join(folder, 'blocker');
    await writeFile(blocked, 'a file where a folder is needed');
    const onSaveError = vi.fn();
    const store = await openFileCatalogStore({ path: join(blocked, 'catalog.json'), onSaveError });
    const catalog = createCatalog({ ytMusic: fakeYtMusic(), store });
    const track = await firstTrack(catalog);

    await store.flush();
    await store.flush();
    expect(onSaveError).toHaveBeenCalledTimes(2);
    expect(await catalog.getTrack(track.id)).toMatchObject({ ok: true });
  });
});

describe('store limits', () => {
  it('drops the oldest records, but never a correction', () => {
    const store = createMemoryCatalogStore({ maxEntries: 2 });
    store.setOverride('keep', { rejectSourceIds: ['x'] });
    for (const id of ['a', 'b', 'c']) store.rememberArtistRef(id, `chan-${id}`);
    expect(store.artistRef('a')).toBeUndefined();
    expect(store.artistRef('c')).toBe('chan-c');
    expect(store.getOverride('keep')).toBeDefined();
  });

  it('counts a re-saved record as new', () => {
    const store = createMemoryCatalogStore({ maxEntries: 2 });
    store.rememberArtistRef('a', '1');
    store.rememberArtistRef('b', '2');
    store.rememberArtistRef('a', '1');
    store.rememberArtistRef('c', '3');
    expect(store.artistRef('a')).toBe('1');
    expect(store.artistRef('b')).toBeUndefined();
  });
});

describe('match cache', () => {
  const setup = (ytMusic: YtMusicPort) => {
    const clock = { time: 1_000 };
    return { clock, catalog: createCatalog({ ytMusic, now: () => clock.time }), trackId: randomUUID() };
  };

  it('answers a repeat request without the provider', async () => {
    const ytMusic = fakeYtMusic();
    const { catalog, trackId } = setup(ytMusic);
    await catalog.findCandidates(trackId, { hint });
    await catalog.findCandidates(trackId, { hint });
    expect(ytMusic.searchTracks).toHaveBeenCalledTimes(1);
  });

  it('checks again once a match expires', async () => {
    const ytMusic = fakeYtMusic();
    const { catalog, clock, trackId } = setup(ytMusic);
    await catalog.findCandidates(trackId, { hint });
    clock.time += 31 * DAY;
    await catalog.findCandidates(trackId, { hint });
    expect(ytMusic.searchTracks).toHaveBeenCalledTimes(2);
  });

  it('retries a no-match far sooner, because the fault may have been temporary', async () => {
    const ytMusic = fakeYtMusic({ searchTracks: vi.fn(async () => []) });
    const { catalog, clock, trackId } = setup(ytMusic);
    await catalog.findCandidates(trackId, { hint });
    const firstCalls = vi.mocked(ytMusic.searchTracks).mock.calls.length;

    await catalog.findCandidates(trackId, { hint });
    expect(ytMusic.searchTracks).toHaveBeenCalledTimes(firstCalls);

    clock.time += 2 * HOUR;
    await catalog.findCandidates(trackId, { hint });
    expect(vi.mocked(ytMusic.searchTracks).mock.calls.length).toBeGreaterThan(firstCalls);
  });

  it('still answers from an old match during an outage', async () => {
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(async () => [song()]);
    const { catalog, clock, trackId } = setup(fakeYtMusic({ searchTracks }));
    await catalog.findCandidates(trackId, { hint });
    clock.time += 31 * DAY;
    searchTracks.mockImplementation(failing('network'));
    expect(await catalog.findCandidates(trackId, { hint })).toMatchObject({ ok: true, value: { accepted: { sourceId: 'vid-studio' } } });
  });

  it('does not answer a cancelled request with old data', async () => {
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(async () => [song()]);
    const { catalog, clock, trackId } = setup(fakeYtMusic({ searchTracks }));
    await catalog.findCandidates(trackId, { hint });
    clock.time += 31 * DAY;
    searchTracks.mockImplementation(failing('cancelled'));
    expect(await catalog.findCandidates(trackId, { hint })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('applies a correction straight away, instead of serving the saved match', async () => {
    const ytMusic = fakeYtMusic();
    const { catalog, trackId } = setup(ytMusic);
    await catalog.findCandidates(trackId, { hint });
    catalog.setMatchOverride(trackId, { rejectSourceIds: ['vid-studio'] });
    expect(await catalog.findCandidates(trackId, { hint })).toMatchObject({ ok: true, value: { status: 'no-match' } });
  });
});

describe('metadata freshness', () => {
  const opened = async (ytMusic: YtMusicPort) => {
    const clock = { time: 1_000 };
    const catalog = createCatalog({ ytMusic, now: () => clock.time });
    const track = await firstTrack(catalog);
    return { catalog, clock, track, albumId: track.albumId as string, artistId: track.artists[0]?.id as string };
  };

  it('refreshes an album and an artist after a week', async () => {
    const ytMusic = fakeYtMusic();
    const { catalog, clock, albumId, artistId } = await opened(ytMusic);
    await catalog.getAlbum(albumId);
    await catalog.getArtist(artistId);
    clock.time += 8 * DAY;
    await catalog.getAlbum(albumId);
    await catalog.getArtist(artistId);
    expect(ytMusic.album).toHaveBeenCalledTimes(2);
    expect(ytMusic.artist).toHaveBeenCalledTimes(2);
  });

  it('keeps old metadata when a refresh fails, and reports it as stale', async () => {
    const album = vi.fn<YtMusicPort['album']>(async () => ({ ...albumRow, tracks: [song()] }));
    const artist = vi.fn<YtMusicPort['artist']>(async () => artistRow);
    const { catalog, clock, albumId, artistId } = await opened(fakeYtMusic({ album, artist }));
    await catalog.getAlbum(albumId);
    await catalog.getArtist(artistId);
    expect(catalog.freshness(albumId)).toMatchObject({ stale: false });

    clock.time += 8 * DAY;
    album.mockImplementation(failing('network'));
    artist.mockImplementation(failing('provider'));
    expect(await catalog.getAlbum(albumId)).toMatchObject({ ok: true, value: { title: 'Harbor Lights' } });
    expect(await catalog.getArtist(artistId)).toMatchObject({ ok: true, value: { name: 'The Paper Lanterns' } });
    expect(catalog.freshness(albumId)).toMatchObject({ stale: true });
    expect(catalog.freshness(artistId)).toMatchObject({ stale: true });
  });

  it('reports an error when there is nothing saved to fall back on', async () => {
    const { catalog, albumId } = await opened(fakeYtMusic({ album: failing('network') }));
    expect(await catalog.getAlbum(albumId)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
  });

  it('has no freshness for an unknown ID', () => {
    expect(createCatalog({ ytMusic: fakeYtMusic() }).freshness(randomUUID())).toBeNull();
  });

  it('keeps showing an expired search during an outage', async () => {
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(async () => [song()]);
    const { catalog, clock } = await opened(fakeYtMusic({ searchTracks }));
    clock.time += HOUR;
    searchTracks.mockImplementation(failing('network'));
    const result = await catalog.search('harbor', null);
    expect(result.ok && result.value.items[0]?.kind).toBe('track');
  });
});

describe('backoff', () => {
  const limited = () => {
    const clock = { time: 1_000 };
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(failing('rate-limited'));
    const ytMusic = fakeYtMusic({ searchTracks });
    return { clock, searchTracks, catalog: createCatalog({ ytMusic, now: () => clock.time }) };
  };
  const retryAfter = async (catalog: ReturnType<typeof createCatalog>, query: string): Promise<number | undefined> => {
    const result = await catalog.search(query, null);
    return result.ok ? undefined : result.error.retryAfterMs;
  };

  it('stops calling the provider after a refusal and says how long to wait', async () => {
    const { catalog, clock, searchTracks } = limited();
    expect(await retryAfter(catalog, 'one')).toBe(30_000);
    clock.time += 10_000;
    expect(await retryAfter(catalog, 'two')).toBe(20_000);
    expect(searchTracks).toHaveBeenCalledTimes(1);
  });

  it('waits longer each time, up to a limit', async () => {
    const { catalog, clock } = limited();
    const waits: Array<number | undefined> = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const wait = await retryAfter(catalog, `query ${attempt}`);
      waits.push(wait);
      clock.time += wait ?? 0;
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
  });

  it('counts one search as one refusal, though it sends several calls', async () => {
    const clock = { time: 1_000 };
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks: failing('rate-limited'), searchAlbums: failing('rate-limited'), searchArtists: failing('rate-limited') }), now: () => clock.time });
    expect(await retryAfter(catalog, 'one')).toBe(30_000);
  });

  it('starts over after a success', async () => {
    const { catalog, clock, searchTracks } = limited();
    const first = await retryAfter(catalog, 'one');
    clock.time += first ?? 0;
    searchTracks.mockImplementation(async () => [song()]);
    expect((await catalog.search('two', null)).ok).toBe(true);
    searchTracks.mockImplementation(failing('rate-limited'));
    expect(await retryAfter(catalog, 'three')).toBe(30_000);
  });

  it('still serves saved matches while waiting', async () => {
    const clock = { time: 1_000 };
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(async () => [song()]);
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks }), now: () => clock.time });
    const trackId = randomUUID();
    await catalog.findCandidates(trackId, { hint });
    searchTracks.mockImplementation(failing('rate-limited'));
    await catalog.search('other', null);
    expect(await catalog.findCandidates(trackId, { hint })).toMatchObject({ ok: true, value: { status: 'matched' } });
  });

  it('does not treat an outage as a reason to wait', async () => {
    const clock = { time: 1_000 };
    const searchTracks = vi.fn<YtMusicPort['searchTracks']>(failing('network'));
    const catalog = createCatalog({ ytMusic: fakeYtMusic({ searchTracks }), now: () => clock.time });
    await catalog.search('one', null);
    await catalog.search('two', null);
    expect(searchTracks).toHaveBeenCalledTimes(2);
  });
});
