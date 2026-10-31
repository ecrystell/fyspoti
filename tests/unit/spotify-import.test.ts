import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { LibraryError, type AddPlaylistItemInput, type Library, type Playlist, type PlaylistItem } from '@fyspoti/contracts';
import {
  ImportFormatError,
  applyImportEntry,
  parseSpotifyExport,
  previewSpotifyImport,
  provisionalTrackId,
  readSpotifyArchive,
  uuidV5,
  type ImportResolver,
} from '@fyspoti/catalog';
import { createLibrary, createMemoryClient, signInWithPassword } from '@fyspoti/library';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Synthetic: invented names and well-formed but meaningless track IDs.
const uri = (seed: string) => `spotify:track:${seed.padEnd(22, '0')}`;
const track = (seed: string, name: string) => ({
  track: { trackName: name, artistName: 'Fixture Artist', albumName: 'Fixture Album', trackUri: uri(seed) },
  episode: null,
  audiobook: null,
  localTrack: null,
  addedDate: '2026-01-01',
});

const playlistFile = JSON.stringify({
  playlists: [
    {
      name: 'Road Trip',
      lastModifiedDate: '2026-01-02',
      description: null,
      numberOfFollowers: 0,
      items: [
        track('a', 'First Song'),
        { track: null, episode: { episodeName: 'Fixture Show' }, audiobook: null, localTrack: null },
        track('b', 'Second Song'),
        track('a', 'First Song'),
        { track: null, episode: null, audiobook: null, localTrack: { uri: 'spotify:local:x' } },
        { track: { trackName: 'Missing URI', artistName: 'Fixture Artist' } },
        track('c', 'Third Song'),
      ],
    },
  ],
});

const libraryFile = JSON.stringify({
  tracks: [{ artist: 'Fixture Artist', album: 'Fixture Album', track: 'Liked One', uri: uri('l') }],
  albums: [{ artist: 'Fixture Artist', album: 'Fixture Album', uri: 'spotify:album:x' }],
  artists: [{ name: 'Fixture Artist', uri: 'spotify:artist:x' }, { name: 'Other', uri: 'spotify:artist:y' }],
  shows: [],
  episodes: [],
});

const files = [
  { name: 'Playlist1.json', text: playlistFile },
  { name: 'YourLibrary.json', text: libraryFile },
];

function memoryLibrary(fail: (call: number) => LibraryError | null = () => null) {
  const playlists: Playlist[] = [];
  const items: PlaylistItem[] = [];
  let calls = 0;
  const library: Library = {
    async createPlaylist(title) {
      const playlist: Playlist = { id: `playlist-${playlists.length}`, ownerId: 'owner', title, visibility: 'private', createdAt: '2026-10-31T00:00:00Z' };
      playlists.push(playlist);
      return playlist;
    },
    async addPlaylistItem(playlistId, input: AddPlaylistItemInput) {
      calls += 1;
      const failure = fail(calls);
      if (failure) throw failure;
      if (items.some((item) => item.playlistId === playlistId && item.orderingKey === input.orderingKey)) throw new LibraryError('CONFLICT', 'Occupied');
      const item: PlaylistItem = { id: `item-${items.length}`, playlistId, ...input };
      items.push(item);
      return item;
    },
    listPlaylists: async () => ({ items: playlists, nextCursor: null }),
    getPlaylist: async (id) => playlists.find((playlist) => playlist.id === id)!,
    listPlaylistItems: async (playlistId) => ({ items: items.filter((item) => item.playlistId === playlistId), nextCursor: null }),
  };
  return { library, playlists, items };
}

const firstEntry = async (resolver?: ImportResolver) => (await previewSpotifyImport(parseSpotifyExport([files[0]!]), resolver)).entries[0]!;

describe('reading the Spotify archive', () => {
  it('opens only playlist and library files, wherever they sit in the ZIP', () => {
    const archive = zipSync({
      'Spotify Account Data/Playlist1.json': strToU8(playlistFile),
      'Spotify Account Data/YourLibrary.json': strToU8(libraryFile),
      'Spotify Account Data/Userdata.json': strToU8('{"email":"someone@example.test","birthdate":"2000-01-01"}'),
      'Spotify Account Data/Payments.json': strToU8('{"card":"visa"}'),
      'Spotify Account Data/StreamingHistory_music_0.json': strToU8('[]'),
    });
    const read = readSpotifyArchive(archive);
    expect(read.map((file) => file.name).sort()).toEqual(['Playlist1.json', 'YourLibrary.json']);
    expect(read.map((file) => file.text).join('')).not.toContain('someone@example.test');
  });

  it('rejects anything that is not a ZIP', () => {
    expect(() => readSpotifyArchive(strToU8('not a zip'))).toThrow(ImportFormatError);
  });

  it('explains when the ZIP is the wrong package', () => {
    const archive = zipSync({ 'Spotify Extended Streaming History/Streaming_History_Audio_2026.json': strToU8('[]') });
    expect(() => readSpotifyArchive(archive)).toThrow(/Account data/);
  });
});

describe('parsing the export', () => {
  it('keeps order and duplicates, and accounts for every skipped row', () => {
    const { playlists } = parseSpotifyExport(files);
    expect(playlists[0]!.rows.map((row) => [row.position, row.title])).toEqual([
      [0, 'First Song'],
      [2, 'Second Song'],
      [3, 'First Song'],
      [6, 'Third Song'],
    ]);
    expect(playlists[0]!.skipped).toEqual({ episode: 1, audiobook: 0, 'local-track': 1, malformed: 1 });
  });

  it('reads liked songs and counts saved albums and artists', () => {
    const parsed = parseSpotifyExport(files);
    expect(parsed.likedSongs!.rows.map((row) => row.title)).toEqual(['Liked One']);
    expect([parsed.savedAlbums, parsed.savedArtists]).toEqual([1, 2]);
  });

  it('orders numbered playlist files numerically', () => {
    const named = (name: string) => JSON.stringify({ playlists: [{ name, items: [track('a', 'Song')] }] });
    const parsed = parseSpotifyExport([{ name: 'Playlist10.json', text: named('tenth') }, { name: 'Playlist2.json', text: named('second') }]);
    expect(parsed.playlists.map((playlist) => playlist.title)).toEqual(['second', 'tenth']);
  });

  it('fails loudly if Spotify changes the layout rather than importing nothing', () => {
    const changed = JSON.stringify({ playlists: [{ name: 'Road Trip', items: [{ track: { title: 'Renamed field' } }] }] });
    expect(() => parseSpotifyExport([{ name: 'Playlist1.json', text: changed }])).toThrow(ImportFormatError);
    expect(() => parseSpotifyExport([{ name: 'Playlist1.json', text: '{"lists":[]}' }])).toThrow(/expected layout/);
    expect(() => parseSpotifyExport([{ name: 'Playlist1.json', text: '{broken' }])).toThrow(/valid JSON/);
  });

  it('never puts user data in error messages', () => {
    const changed = JSON.stringify({ playlists: [{ name: 'Private Diary Mix', items: [{ track: { title: 'Secret' } }] }] });
    try {
      parseSpotifyExport([{ name: 'Playlist1.json', text: changed }]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/Private Diary Mix|Secret/);
    }
  });
});

describe('provisional identity', () => {
  it('implements UUIDv5', async () => {
    // Published reference value: Python's uuid5(NAMESPACE_DNS, 'python.org').
    expect(await uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('is stable per recording, distinct between recordings and accepted by the library', async () => {
    const id = await provisionalTrackId(uri('a'));
    expect(id).toMatch(UUID);
    expect(await provisionalTrackId(uri('a'))).toBe(id);
    expect(await provisionalTrackId(uri('b'))).not.toBe(id);
  });
});

describe('previewing the import', () => {
  it('writes nothing and reports counts', async () => {
    const entry = await firstEntry();
    expect(entry.title).toBe('Road Trip');
    expect(entry.counts).toEqual({ resolved: 4, ambiguous: 0, unmatched: 0, duplicates: 1 });
  });

  it('lists liked songs first and surfaces what will not be imported', async () => {
    const preview = await previewSpotifyImport(parseSpotifyExport(files));
    expect(preview.entries.map((entry) => entry.kind)).toEqual(['liked-songs', 'playlist']);
    expect(preview.notImported).toEqual({ savedAlbums: 1, savedArtists: 2 });
  });

  it('names untitled playlists and fits long titles to the library limit', async () => {
    const long = '𝄞'.repeat(250);
    const text = JSON.stringify({ playlists: [{ name: null, items: [] }, { name: long, items: [] }] });
    const { entries } = await previewSpotifyImport(parseSpotifyExport([{ name: 'Playlist1.json', text }]));
    expect(entries[0]!.title).toBe('Untitled playlist');
    expect([...entries[1]!.title]).toHaveLength(200);
  });
});

describe('applying the import through the real library adapter', () => {
  it('passes its validation and writes the expected rows', async () => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const playlistId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-31T00:00:00Z' };
    const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
    const row = { id: playlistId, owner_id: owner, title: 'Road Trip', visibility: 'private', created_at: '2026-10-31T00:00:00Z' };
    const written: Record<string, unknown>[] = [];

    const client = createMemoryClient('http://127.0.0.1:54321', 'synthetic-public-key', async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith('/token')) return Response.json({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user });
      if (url.pathname.endsWith('/user')) return Response.json(user);
      if (url.pathname.endsWith('/playlist_items')) {
        const body = JSON.parse(init!.body as string) as Record<string, unknown>;
        written.push(body);
        return Response.json({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ...body });
      }
      return Response.json(row);
    });
    await signInWithPassword(client, user.email, 'password');

    const outcome = await applyImportEntry(createLibrary(client), await firstEntry());

    expect(outcome).toEqual({ status: 'complete', playlistId, imported: 4, notImported: 0 });
    expect(written.map((item) => item['ordering_key'])).toEqual([0, 2, 3, 6]);
    expect(written[0]).toMatchObject({ playlist_id: playlistId, snapshot_title: 'First Song', snapshot_artist_names: ['Fixture Artist'], snapshot_duration_ms: 0 });
    expect(written[0]!['track_id']).toMatch(UUID);
    expect(written[0]!['track_id']).toBe(written[2]!['track_id']);
  });
});

describe('applying the import', () => {
  it('creates a private playlist with order and duplicates intact', async () => {
    const { library, playlists, items } = memoryLibrary();
    const outcome = await applyImportEntry(library, await firstEntry());
    expect(outcome).toEqual({ status: 'complete', playlistId: 'playlist-0', imported: 4, notImported: 0 });
    expect(playlists[0]!.visibility).toBe('private');
    expect(items.map((item) => item.orderingKey)).toEqual([0, 2, 3, 6]);
    expect(items[0]!.trackId).toBe(items[2]!.trackId);
    expect(items[0]!.id).not.toBe(items[2]!.id);
    expect(items[0]!.metadataSnapshot).toEqual({ title: 'First Song', artistNames: ['Fixture Artist'], durationMs: 0 });
  });

  it('never imports ambiguous or unmatched rows', async () => {
    const resolver: ImportResolver = async (row) => {
      if (row.title === 'First Song') return { status: 'ambiguous', reason: 'Two versions fit' };
      if (row.title === 'Second Song') return { status: 'unmatched', reason: 'Nothing found' };
      return { status: 'resolved', provisional: false, trackId: await provisionalTrackId(row.uri), metadataSnapshot: { title: row.title, artistNames: [row.artistName], durationMs: 1000 } };
    };
    const { library, items } = memoryLibrary();
    const outcome = await applyImportEntry(library, await firstEntry(resolver));
    expect(items.map((item) => item.metadataSnapshot.title)).toEqual(['Third Song']);
    expect(outcome).toMatchObject({ status: 'complete', imported: 1, notImported: 3 });
  });

  it('stops at a failure without replaying the write', async () => {
    const { library, items } = memoryLibrary((call) => (call === 2 ? new LibraryError('UNAVAILABLE', 'Down', true) : null));
    const outcome = await applyImportEntry(library, await firstEntry());
    expect(outcome).toEqual({
      status: 'interrupted',
      resume: { playlistId: 'playlist-0', nextPosition: 2 },
      imported: 1,
      error: { code: 'UNAVAILABLE', retryable: true },
    });
    expect(items).toHaveLength(1);
  });

  it('resumes into the same playlist', async () => {
    let failing = true;
    const { library, playlists, items } = memoryLibrary((call) => (failing && call === 2 ? new LibraryError('UNAVAILABLE', 'Down', true) : null));
    const entry = await firstEntry();
    const first = await applyImportEntry(library, entry);
    failing = false;
    const second = await applyImportEntry(library, entry, first.status === 'interrupted' ? first.resume! : undefined);
    expect(second).toMatchObject({ status: 'complete', imported: 3 });
    expect(playlists).toHaveLength(1);
    expect(items.map((item) => item.orderingKey)).toEqual([0, 2, 3, 6]);
  });

  it('treats the resumed item as saved if its write landed before the reply was lost', async () => {
    const { library, items } = memoryLibrary();
    const entry = await firstEntry();
    const finished = await applyImportEntry(library, entry);
    const playlistId = finished.status === 'complete' ? finished.playlistId : '';
    items.splice(2);
    expect(await applyImportEntry(library, entry, { playlistId, nextPosition: 2 })).toMatchObject({ status: 'complete', imported: 2 });
    expect(items.map((item) => item.orderingKey).sort((a, b) => a - b)).toEqual([0, 2, 3, 6]);
  });

  it('reports a conflict anywhere else as a failure', async () => {
    const { library } = memoryLibrary((call) => (call === 2 ? new LibraryError('CONFLICT', 'Occupied') : null));
    expect(await applyImportEntry(library, await firstEntry())).toMatchObject({ status: 'interrupted', error: { code: 'CONFLICT', retryable: false } });
  });

  it('reports a failed create with no resume point', async () => {
    const { library } = memoryLibrary();
    library.createPlaylist = async () => {
      throw new LibraryError('AUTH_REQUIRED', 'Sign in');
    };
    expect(await applyImportEntry(library, await firstEntry())).toEqual({ status: 'interrupted', resume: null, imported: 0, error: { code: 'AUTH_REQUIRED', retryable: false } });
  });
});
