import { LibraryError, Track, type LibraryApi, type MutationContext, type Result, type TrackLike, type TrackMetadataSnapshot } from '@fyspoti/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ItemRow, Json, LikeRow, PlaylistRow } from './database.js';
import { checkId, checkItem, checkText, checkTrackId, createLibrary, decodeCursor, encodeCursor, executeMutation, invalid, playlist, playlistItem, requireOwner, translateError } from './core.js';

export function like(row: LikeRow): TrackLike {
  return { id: row.id, trackId: row.track_id, liked: row.liked, revision: row.revision,
    metadataSnapshot: { title: row.snapshot_title, artistNames: row.snapshot_artist_names, durationMs: row.snapshot_duration_ms } };
}

function snapshot(track: Track): { trackId: string; metadataSnapshot: TrackMetadataSnapshot } {
  const parsed = Track.safeParse(track);
  if (!parsed.success) invalid('Expected a valid catalog Track.');
  checkTrackId(parsed.data.id);
  checkText(parsed.data.title, 500, 'Track title');
  if (parsed.data.artists.length > 50) invalid('Expected at most 50 artist names.');
  parsed.data.artists.forEach(artist => checkText(artist.name, 500, 'Artist name'));
  if (parsed.data.durationMs > 86400000) invalid('Track duration exceeds the snapshot limit.');
  return { trackId: parsed.data.id, metadataSnapshot: {
    title: parsed.data.title, artistNames: parsed.data.artists.map(artist => artist.name), durationMs: parsed.data.durationMs,
  } };
}

function editPayload(playlistId: string, context: MutationContext): { [key: string]: Json } {
  checkId(playlistId);
  if (!context) invalid('A mutation context is required.');
  checkId(context.mutationId);
  if (!Number.isInteger(context.expectedRevision) || context.expectedRevision < 1 || context.expectedRevision > 2147483647) invalid('Expected a positive playlist revision.');
  return { playlistId, expectedRevision: context.expectedRevision };
}

export function createLibraryApi(client: SupabaseClient<Database>, options: { pageSize?: number; accountId?: string } = {}): LibraryApi {
  const legacy = createLibrary(client, options);
  const pageSize = options.pageSize ?? 50;
  async function result<T>(operation: (owner: string) => Promise<T>): Promise<Result<T>> {
    try {
      const owner = await requireOwner(client);
      if (options.accountId && options.accountId !== owner) throw new LibraryError('AUTH_REQUIRED', 'Account changed.');
      const value = await operation(owner);
      // Suppress data fetched for an account whose session changed mid-request.
      if (await requireOwner(client) !== owner) throw new LibraryError('AUTH_REQUIRED', 'Account changed.');
      return { ok: true, value };
    } catch (error) {
      const failure = translateError(error);
      return { ok: false, error: { code: failure.code, message: failure.message, retryable: failure.retryable } };
    }
  }
  async function mutate<T>(owner: string, operation: string, mutationId: string, payload: { [key: string]: Json | undefined }): Promise<T> {
    return await executeMutation(client, operation, mutationId, payload, owner) as unknown as T;
  }
  return {
    createPlaylist: (title, mutationId) => result(async owner => {
      checkText(title, 200, 'Playlist title');
      return playlist(await mutate<PlaylistRow>(owner, 'create', mutationId, { title: title.trim() }));
    }),
    listPlaylists: cursor => result(() => legacy.listPlaylists(cursor)),
    getPlaylist: id => result(() => legacy.getPlaylist(id)),
    listPlaylistItems: (id, cursor) => result(() => legacy.listPlaylistItems(id, cursor)),
    setTrackLiked: (track, liked, mutationId) => result(async owner => {
      if (typeof liked !== 'boolean') invalid('Expected an explicit like state.');
      const value = snapshot(track);
      return like(await mutate<LikeRow>(owner, 'like', mutationId, { trackId: value.trackId, metadataSnapshot: { ...value.metadataSnapshot }, liked }));
    }),
    setTrackLikeFromSnapshot: (trackId, metadataSnapshot, liked, mutationId) => result(async owner => {
      checkItem({ trackId, metadataSnapshot, orderingKey: 0 });
      if (typeof liked !== 'boolean') invalid('Expected an explicit like state.');
      return like(await mutate<LikeRow>(owner, 'like', mutationId, { trackId, metadataSnapshot: { ...metadataSnapshot }, liked }));
    }),
    getTrackLike: trackId => result(async owner => {
      checkTrackId(trackId);
      const { data, error, status } = await client.from('track_likes').select('*').eq('owner_id', owner).eq('track_id', trackId).maybeSingle().retry(false);
      if (error) throw translateError({ ...error, status });
      return data ? like(data) : { id: null, trackId, liked: false, revision: 0, metadataSnapshot: null };
    }),
    listLikedTracks: cursor => result(async owner => {
      const after = decodeCursor(cursor, 'likes', owner, 'liked-tracks');
      let query = client.from('track_likes').select('*').eq('owner_id', owner).eq('liked', true).order('id').limit(pageSize + 1);
      if (after) query = query.gt('id', after.last as string);
      const { data, error, status } = await query.retry(false);
      if (error) throw translateError({ ...error, status });
      const items = data.slice(0, pageSize).map(like);
      return { items, nextCursor: data.length > pageSize ? encodeCursor({ v: 1, kind: 'likes', owner, scope: 'liked-tracks', last: items[items.length - 1]!.id! }) : null };
    }),
    appendTrack: (playlistId, track, context) => result(async owner => {
      const edit = editPayload(playlistId, context);
      const value = snapshot(track);
      const response = await mutate<{ playlist: PlaylistRow; item: ItemRow }>(owner, 'insert_item', context.mutationId,
        { ...edit, trackId: value.trackId, metadataSnapshot: { ...value.metadataSnapshot } });
      return { playlist: playlist(response.playlist), item: playlistItem(response.item) };
    }),
    renamePlaylist: (id, title, context) => result(async owner => {
      const edit = editPayload(id, context);
      checkText(title, 200, 'Playlist title');
      return playlist(await mutate<PlaylistRow>(owner, 'rename', context.mutationId, { ...edit, title: title.trim() }));
    }),
    removePlaylistItem: (id, itemId, context) => result(async owner => {
      const edit = editPayload(id, context);
      checkId(itemId);
      return playlist(await mutate<PlaylistRow>(owner, 'remove_item', context.mutationId, { ...edit, itemId }));
    }),
    reorderPlaylistItems: (id, itemIds, context) => result(async owner => {
      const edit = editPayload(id, context);
      if (!Array.isArray(itemIds)) invalid('Expected playlist item IDs.');
      itemIds.forEach(checkId);
      return playlist(await mutate<PlaylistRow>(owner, 'reorder', context.mutationId, { ...edit, itemIds }));
    }),
    deletePlaylist: (id, context) => result(async owner => {
      const response = await mutate<PlaylistRow>(owner, 'delete', context.mutationId, editPayload(id, context));
      return { id: response.id, revision: response.revision };
    }),
  };
}
