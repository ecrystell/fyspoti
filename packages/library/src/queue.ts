import type { LibraryApi, Result } from '@fyspoti/contracts';

/** Structurally matches P2 QueueItem, without pulling Electron into this package. */
export interface LibraryQueueItem {
  id: string; trackId: string; title: string; artist: string; durationMs: number;
}
export interface LibraryQueue { playlistId: string; revision: number; items: LibraryQueueItem[] }
export interface QueueTarget { setQueue(items: LibraryQueueItem[], startId?: string): Promise<void> }

export async function preparePlaylistQueue(api: LibraryApi, playlistId: string): Promise<Result<LibraryQueue>> {
  const before = await api.getPlaylist(playlistId);
  if (!before.ok) return before;
  const items: LibraryQueueItem[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listPlaylistItems(playlistId, cursor);
    if (!page.ok) return page;
    for (const item of page.value.items) {
      items.push({ id: item.id, trackId: item.trackId, title: item.metadataSnapshot.title,
        artist: item.metadataSnapshot.artistNames.join(', '), durationMs: item.metadataSnapshot.durationMs });
    }
    if (items.length > 10000) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Playback supports at most 10000 queue items.', retryable: false } };
    cursor = page.value.nextCursor ?? undefined;
    if (cursor) {
      if (seen.has(cursor)) return { ok: false, error: { code: 'UNAVAILABLE', message: 'Invalid pagination response.', retryable: true } };
      seen.add(cursor);
    }
  } while (cursor);
  const after = await api.getPlaylist(playlistId);
  if (!after.ok) return after;
  if (before.value.revision !== after.value.revision || new Set(items.map(item => item.id)).size !== items.length) {
    return { ok: false, error: { code: 'CONFLICT', message: 'The playlist changed while preparing playback. Refresh and try again.', retryable: false } };
  }
  return { ok: true, value: { playlistId, revision: after.value.revision, items } };
}

export async function playPlaylist(api: LibraryApi, player: QueueTarget, playlistId: string, startId?: string): Promise<Result<LibraryQueue>> {
  const prepared = await preparePlaylistQueue(api, playlistId);
  if (!prepared.ok) return prepared;
  if (startId !== undefined && !prepared.value.items.some(item => item.id === startId)) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Start item is not in this playlist.', retryable: false } };
  }
  try {
    await player.setQueue(prepared.value.items.map(item => ({ ...item })), startId);
    return prepared;
  } catch {
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'The player could not accept the queue.', retryable: true } };
  }
}
