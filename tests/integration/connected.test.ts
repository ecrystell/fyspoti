import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogFixtures, createMockCatalog } from '@fyspoti/contracts/testing';
import type { Playlist, Result, Track } from '@fyspoti/contracts';
import { createLibraryApi, createMemoryClient, playPlaylist, preparePlaylistQueue } from '@fyspoti/library';
import { Player } from '../../p2/src/player.ts';
import type { AudioEngine, AudioEvent, SourceResolver } from '../../p2/src/contracts.ts';
import { testAccounts } from './support.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected success, received ${result.error.code}: ${result.error.message}`);
  return result.value;
}
const context = (playlist: Playlist) => ({ mutationId: randomUUID(), expectedRevision: playlist.revision });
const fixtures = CatalogFixtures.parse(JSON.parse(await readFile(new URL('../fixtures/catalog/catalog.json', import.meta.url), 'utf8')));
class FixtureAudio implements AudioEngine {
  onEvent(_listener: (event: AudioEvent) => void) { return () => {}; }
  async load() {} async play() {} pause() {} seek() {} setVolume() {} unload() {}
}

describe('connected core library', () => {
  const accounts = testAccounts();
  let a: Awaited<ReturnType<typeof accounts.provision>>;
  let b: typeof a;
  let track: Track;
  let second: Track;
  const catalog = createMockCatalog(fixtures);
  beforeAll(async () => {
    a = await accounts.provision('a'); b = await accounts.provision('b');
    const search = value(await catalog.search('harbor', null));
    const hit = search.items.find(item => item.kind === 'track');
    if (!hit || hit.kind !== 'track') throw new Error('Expected catalog fixture track');
    track = hit.track; second = fixtures.tracks.find(item => item.id !== track.id)!;
  });
  afterAll(() => accounts.cleanup());
  const api = () => createLibraryApi(a.client, { pageSize: 2, accountId: a.id });

  it('searches, likes, appends duplicates, reorders, reloads, and plays through the real P2 Player', async () => {
    const library = api();
    const like = value(await library.setTrackLiked(track, true, randomUUID()));
    expect(like.trackId).toBe(track.id);
    let playlist = value(await library.createPlaylist('Connected journey', randomUUID()));
    const first = value(await library.appendTrack(playlist.id, track, context(playlist))); playlist = first.playlist;
    const duplicate = value(await library.appendTrack(playlist.id, track, context(playlist))); playlist = duplicate.playlist;
    const other = value(await library.appendTrack(playlist.id, second, context(playlist))); playlist = other.playlist;
    const ordered = [other.item.id, duplicate.item.id, first.item.id];
    playlist = value(await library.reorderPlaylistItems(playlist.id, ordered, context(playlist)));
    const fresh = createLibraryApi(await a.fresh(), { pageSize: 2, accountId: a.id });
    expect(value(await fresh.getPlaylist(playlist.id))).toEqual(playlist);
    expect(value(await fresh.getTrackLike(track.id)).liked).toBe(true);
    const resolver: SourceResolver = { resolve: async () => ({ uri: 'https://example.test/rights-cleared-fixture.wav', local: false, seekable: true }) };
    const player = new Player(new FixtureAudio(), resolver);
    value(await playPlaylist(fresh, player, playlist.id, duplicate.item.id));
    expect(player.snapshot().status).toBe('playing');
    expect(player.snapshot().currentItemId).toBe(duplicate.item.id);
    expect(player.snapshot().queue.map(item => item.id)).toEqual(ordered);
    expect(player.snapshot().queue.map(item => item.trackId)).toEqual([second.id, track.id, track.id]);
    playlist = value(await library.removePlaylistItem(playlist.id, duplicate.item.id, context(playlist)));
    expect(value(await preparePlaylistQueue(library, playlist.id)).items.map(item => item.id)).toEqual([other.item.id, first.item.id]);
    expect(player.snapshot().queue.map(item => item.id)).toEqual(ordered); // Active queue is independent.
    player.stop();
  });

  it('replays create, append, rename, reorder, remove and delete exactly once', async () => {
    const library = api();
    const createId = randomUUID();
    let playlist = value(await library.createPlaylist('Replay', createId));
    expect(value(await library.createPlaylist('Replay', createId))).toEqual(playlist);
    const otherAccount = value(await createLibraryApi(b.client).createPlaylist('Independent receipt', createId));
    expect(otherAccount.ownerId).toBe(b.id);
    expect(otherAccount.id).not.toBe(playlist.id);
    expect(await library.createPlaylist('Different', createId)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const edit = context(playlist);
    const added = value(await library.appendTrack(playlist.id, track, edit));
    expect(value(await library.appendTrack(playlist.id, track, edit))).toEqual(added);
    playlist = added.playlist;
    const rename = context(playlist);
    playlist = value(await library.renamePlaylist(playlist.id, 'Renamed', rename));
    expect(value(await library.renamePlaylist(playlist.id, 'Renamed', rename))).toEqual(playlist);
    const reorder = context(playlist);
    playlist = value(await library.reorderPlaylistItems(playlist.id, [added.item.id], reorder));
    expect(value(await library.reorderPlaylistItems(playlist.id, [added.item.id], reorder))).toEqual(playlist);
    const remove = context(playlist);
    playlist = value(await library.removePlaylistItem(playlist.id, added.item.id, remove));
    expect(value(await library.removePlaylistItem(playlist.id, added.item.id, remove))).toEqual(playlist);
    const deletion = context(playlist);
    const deleted = value(await library.deletePlaylist(playlist.id, deletion));
    expect(value(await library.deletePlaylist(playlist.id, deletion))).toEqual(deleted);
    expect(await library.getPlaylist(playlist.id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await library.listPlaylistItems(playlist.id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('serializes concurrent appends and rejects stale rename, reorder, remove and delete', async () => {
    const library = api();
    const playlist = value(await library.createPlaylist('Concurrent', randomUUID()));
    const [one, two] = await Promise.all([library.appendTrack(playlist.id, track, context(playlist)), library.appendTrack(playlist.id, track, context(playlist))]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    const rejected = one.ok ? two : one;
    expect(rejected).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const inserted = value(one.ok ? one : two);
    for (const stale of [
      library.renamePlaylist(playlist.id, 'Stale', context(playlist)),
      library.reorderPlaylistItems(playlist.id, [inserted.item.id], context(playlist)),
      library.removePlaylistItem(playlist.id, inserted.item.id, context(playlist)),
      library.deletePlaylist(playlist.id, context(playlist)),
    ]) expect(await stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(value(await library.getPlaylist(playlist.id)).revision).toBe(2);
    expect(value(await library.listPlaylistItems(playlist.id)).items).toHaveLength(1);
  });

  it('rolls invalid reorder back without changing order or revision, and retains item tombstones', async () => {
    const library = api();
    let playlist = value(await library.createPlaylist('Atomic reorder', randomUUID()));
    const first = value(await library.appendTrack(playlist.id, track, context(playlist))); playlist = first.playlist;
    const next = value(await library.appendTrack(playlist.id, second, context(playlist))); playlist = next.playlist;
    for (const ids of [[first.item.id], [first.item.id, first.item.id], [first.item.id, randomUUID()]]) {
      expect(await library.reorderPlaylistItems(playlist.id, ids, context(playlist))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
      expect(value(await library.getPlaylist(playlist.id)).revision).toBe(playlist.revision);
    }
    expect(value(await library.listPlaylistItems(playlist.id)).items.map(item => item.id)).toEqual([first.item.id, next.item.id]);
    playlist = value(await library.removePlaylistItem(playlist.id, first.item.id, context(playlist)));
    // Private tombstone existence is checked by the separate SQL/upgrade check; not exposed to REST.
    const denied = await a.client.schema('public').from('playlist_items').insert({ playlist_id: playlist.id, id: first.item.id, track_id: track.id,
      ordering_key: 0, snapshot_title: track.title, snapshot_artist_names: track.artists.map(x => x.name), snapshot_duration_ms: track.durationMs });
    expect(denied.error).not.toBeNull();
  });

  it('stores explicit like/unlike state once, preserves removal, and paginates without duplicates', async () => {
    const library = api();
    const operation = randomUUID();
    const initial = value(await library.setTrackLiked(track, true, operation));
    expect(value(await library.setTrackLiked(track, true, operation))).toEqual(initial);
    expect(await library.setTrackLiked(track, false, operation)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const removed = value(await library.setTrackLiked(track, false, randomUUID()));
    expect(value(await library.getTrackLike(track.id))).toEqual(removed);
    expect(removed.liked).toBe(false);
    expect(value(await library.setTrackLiked(track, true, operation))).toEqual(initial);
    expect(value(await library.getTrackLike(track.id)).liked).toBe(false); // Old replay cannot undo a later unlike.
    for (const item of fixtures.tracks.slice(0, 4)) value(await library.setTrackLiked(item, true, randomUUID()));
    const ids: string[] = []; let cursor: string | undefined;
    do {
      const page = value(await library.listLikedTracks(cursor));
      ids.push(...page.items.map(item => item.trackId)); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4);
  });

  it('blocks cross-account RPCs, receipt access, forged accounts, raw writes, and anonymous RPCs', async () => {
    const library = api();
    const playlist = value(await library.createPlaylist('Private', randomUUID()));
    const other = createLibraryApi(b.client);
    expect(await other.renamePlaylist(playlist.id, 'Hijacked', context(playlist))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    for (const [client, accountId] of [[b.client, a.id], [a.client, b.id]] as const) {
      const response = await client.rpc('library_mutate', { operation: 'rename', mutation_id: randomUUID(), payload: { accountId, playlistId: playlist.id, expectedRevision: playlist.revision, title: 'Forged' } });
      expect(response.error).not.toBeNull();
    }
    const anonymous = createMemoryClient(accounts.config.url, accounts.config.key);
    expect((await anonymous.rpc('library_mutate', { operation: 'create', mutation_id: randomUUID(), payload: { title: 'Anonymous', accountId: a.id } })).error).not.toBeNull();
    expect((await a.client.from('playlists').insert({ title: 'Bypass', owner_id: a.id })).error).not.toBeNull();
    expect((await a.client.from('track_likes').insert({ owner_id: a.id, track_id: track.id, liked: true, revision: 1,
      snapshot_title: track.title, snapshot_artist_names: ['Artist'], snapshot_duration_ms: 1 })).error).not.toBeNull();
    const hiddenLikes = await b.client.from('track_likes').select('*').eq('owner_id', a.id);
    expect(hiddenLikes.data).toEqual([]);
    const privateAttempt = await fetch(`${accounts.config.url}/rest/v1/mutation_receipts?select=*`, {
      headers: { apikey: accounts.config.key, Authorization: `Bearer ${(await a.client.auth.getSession()).data.session!.access_token}` },
    });
    expect(privateAttempt.ok).toBe(false);
    expect(value(await library.getPlaylist(playlist.id)).title).toBe('Private');
  });

  it('rejects stream URLs and device-local identities through the API and direct RPC', async () => {
    const library = api();
    for (const id of ['https://example.test/audio', 'local:123', 'p2-media://artifact/id', 'C:\\Music\\track.mp3', 'spotify:track:123']) {
      expect(await library.setTrackLiked({ ...track, id }, true, randomUUID())).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
      const raw = await a.client.rpc('library_mutate', { operation: 'like', mutation_id: randomUUID(), payload: {
        accountId: a.id, trackId: id, liked: true, metadataSnapshot: { title: 'Test', artistNames: ['Artist'], durationMs: 1 },
      } });
      expect(raw.error?.code).toBe('PT400');
    }
  });
});
