import { describe, expect, it, vi } from 'vitest';
import { LibraryController, playPlaylist, preparePlaylistQueue } from '@fyspoti/library';
import type { LibraryApi, Playlist, PlaylistItem, Result } from '@fyspoti/contracts';

const collection: Playlist = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId: 'owner-a', title: 'Fixture', visibility: 'private', createdAt: '2026-10-31T00:00:00Z', revision: 1 };
const item = (id: string, orderingKey: number): PlaylistItem => ({ id, playlistId: collection.id, trackId: 'track-harbor-studio', orderingKey,
  metadataSnapshot: { title: 'Harbor Lights', artistNames: ['First Artist', 'Second Artist'], durationMs: 214000 } });
const entries = [item('first', 0), item('second', 1)];
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const conflict: Result<never> = { ok: false, error: { code: 'CONFLICT', message: 'Changed', retryable: false } };
const unavailable: Result<never> = { ok: false, error: { code: 'UNAVAILABLE', message: 'Disconnected', retryable: true } };
function api(overrides: Partial<LibraryApi> = {}): LibraryApi {
  return {
    createPlaylist: async () => ok(collection), listPlaylists: async () => ok({ items: [collection], nextCursor: null }),
    getPlaylist: async () => ok(collection), listPlaylistItems: async () => ok({ items: entries, nextCursor: null }),
    listLikedTracks: async () => ok({ items: [], nextCursor: null }), getTrackLike: async () => unavailable,
    setTrackLiked: async () => unavailable, appendTrack: async () => unavailable, renamePlaylist: async () => unavailable,
    setTrackLikeFromSnapshot: async () => unavailable,
    removePlaylistItem: async () => unavailable, reorderPlaylistItems: async () => unavailable, deletePlaylist: async () => unavailable,
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('P2 queue handoff', () => {
  it('preserves order and duplicate tracks, joins artists, and starts the selected item', async () => {
    const player = { setQueue: vi.fn(async () => {}) };
    const result = await playPlaylist(api(), player, collection.id, 'second');
    expect(result.ok).toBe(true);
    expect(player.setQueue).toHaveBeenCalledWith([
      { id: 'first', trackId: 'track-harbor-studio', title: 'Harbor Lights', artist: 'First Artist, Second Artist', durationMs: 214000 },
      { id: 'second', trackId: 'track-harbor-studio', title: 'Harbor Lights', artist: 'First Artist, Second Artist', durationMs: 214000 },
    ], 'second');
  });
  it('refuses a queue assembled across two playlist revisions', async () => {
    const getPlaylist = vi.fn<LibraryApi['getPlaylist']>().mockResolvedValueOnce(ok(collection)).mockResolvedValueOnce(ok({ ...collection, revision: 2 }));
    const player = { setQueue: vi.fn(async () => {}) };
    expect(await playPlaylist(api({ getPlaylist }), player, collection.id)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(player.setQueue).not.toHaveBeenCalled();
  });
  it('rejects over-limit queues and invalid start items without truncating playback', async () => {
    const large = api({ listPlaylistItems: async () => ok({ items: Array.from({ length: 10001 }, (_, n) => item(`entry-${n}`, n)), nextCursor: null }) });
    expect(await preparePlaylistQueue(large, collection.id)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    const player = { setQueue: vi.fn(async () => {}) };
    expect(await playPlaylist(api(), player, collection.id, 'missing')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(player.setQueue).not.toHaveBeenCalled();
  });
  it('does not loop forever on a repeated cursor or pass a failed read to the player', async () => {
    const repeated = api({ listPlaylistItems: async () => ok({ items: [], nextCursor: 'same' }) });
    expect(await preparePlaylistQueue(repeated, collection.id)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(await preparePlaylistQueue(api({ getPlaylist: async () => unavailable }), collection.id)).toEqual(unavailable);
  });
});

describe('account-scoped controller', () => {
  it('clears private state and ignores a late load from the previous account', async () => {
    const pending = deferred<Result<{ items: Playlist[]; nextCursor: null }>>();
    const controller = new LibraryController(id => id === 'owner-a' ? api({ listPlaylists: () => pending.promise }) : api({ listPlaylists: async () => ok({ items: [], nextCursor: null }) }));
    controller.setAccount('owner-a');
    const loading = controller.load(collection.id);
    controller.setAccount('owner-b');
    await controller.load();
    pending.resolve(ok({ items: [collection], nextCursor: null }));
    await loading;
    expect(controller.snapshot()).toMatchObject({ accountId: 'owner-b', playlists: [], items: [], playlist: null });
    controller.setAccount(null);
    expect(controller.snapshot()).toMatchObject({ accountId: null, likedTracks: [], playlists: [] });
  });
  it('refreshes a conflict and retries only on request with a new ID and revision', async () => {
    let current = collection;
    const renamePlaylist = vi.fn<LibraryApi['renamePlaylist']>().mockImplementationOnce(async () => { current = { ...collection, revision: 2 }; return conflict; })
      .mockImplementationOnce(async () => { current = { ...current, title: 'Renamed', revision: 3 }; return ok(current); });
    const controller = new LibraryController(() => api({ renamePlaylist, getPlaylist: async () => ok(current), listPlaylists: async () => ok({ items: [current], nextCursor: null }) }));
    controller.setAccount('owner-a'); await controller.load(collection.id);
    expect(await controller.run({ type: 'rename', playlistId: collection.id, title: 'Renamed' })).toEqual(conflict);
    expect(controller.snapshot()).toMatchObject({ phase: 'conflict', playlist: { revision: 2 }, failedAction: { type: 'rename' } });
    expect(renamePlaylist).toHaveBeenCalledTimes(1);
    await controller.retryConflict();
    expect(renamePlaylist.mock.calls[0]![2].expectedRevision).toBe(1);
    expect(renamePlaylist.mock.calls[1]![2].expectedRevision).toBe(2);
    expect(renamePlaylist.mock.calls[1]![2].mutationId).not.toBe(renamePlaylist.mock.calls[0]![2].mutationId);
    expect(controller.snapshot().phase).toBe('ready');
  });
  it('replays an uncertain write only on request, with the original operation ID', async () => {
    const createPlaylist = vi.fn<LibraryApi['createPlaylist']>().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(ok(collection));
    const controller = new LibraryController(() => api({ createPlaylist }));
    controller.setAccount('owner-a');
    await controller.run({ type: 'create', title: 'Fixture' });
    expect(createPlaylist).toHaveBeenCalledTimes(1);
    await controller.retryUncertain();
    expect(createPlaylist.mock.calls[0]![1]).toBe(createPlaylist.mock.calls[1]![1]);
  });
  it('suppresses a late mutation completion after logout and exposes immutable snapshots', async () => {
    const pending = deferred<Result<Playlist>>();
    const controller = new LibraryController(() => api({ createPlaylist: () => pending.promise }));
    controller.setAccount('owner-a'); await controller.load();
    const copy = controller.snapshot(); copy.playlists.length = 0;
    expect(controller.snapshot().playlists).toHaveLength(1);
    const writing = controller.run({ type: 'create', title: 'Fixture' });
    expect(controller.snapshot().phase).toBe('mutation-pending');
    controller.setAccount(null); pending.resolve(ok(collection));
    expect(await writing).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    expect(controller.snapshot()).toMatchObject({ accountId: null, phase: 'ready', playlists: [] });
  });
  it('can replay an uncertain delete after the refreshed list already hides the collection', async () => {
    let deleted = false;
    const deletePlaylist = vi.fn<LibraryApi['deletePlaylist']>().mockImplementationOnce(async () => { deleted = true; return unavailable; })
      .mockResolvedValueOnce(ok({ id: collection.id, revision: 2 }));
    const controller = new LibraryController(() => api({ deletePlaylist, listPlaylists: async () => ok({ items: deleted ? [] : [collection], nextCursor: null }) }));
    controller.setAccount('owner-a'); await controller.load(collection.id);
    await controller.run({ type: 'delete', playlistId: collection.id });
    expect(controller.snapshot().playlists).toEqual([]);
    expect((await controller.retryUncertain()).ok).toBe(true);
    expect(deletePlaylist.mock.calls[0]![1]).toEqual(deletePlaylist.mock.calls[1]![1]);
  });
});
