import type { LibraryApi, LibraryAction, LibraryViewState, MutationContext, Result } from '@fyspoti/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLibraryApi } from './api.js';
import type { Database } from './database.js';

export type { LibraryAction, LibraryViewState } from '@fyspoti/contracts';

const empty = (accountId: string | null): LibraryViewState => ({ accountId, phase: 'ready', playlists: [], likedTracks: [], playlist: null, items: [],
  cursors: { playlists: null, likes: null, items: null }, error: null, failedAction: null, failedContext: null });
const authFailure = (): Result<never> => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to access your library.', retryable: false } });

/** UI state only. Persisted data and playback queues remain in their owning services. */
export class LibraryController {
  private state = empty(null);
  private generation = 0;
  private api: LibraryApi | null = null;
  private busy = false;
  private readonly listeners = new Set<(state: LibraryViewState) => void>();
  constructor(private readonly apiForAccount: (id: string) => LibraryApi) {}
  snapshot(): LibraryViewState { return structuredClone(this.state); }
  subscribe(listener: (state: LibraryViewState) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  private publish(patch: Partial<LibraryViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.snapshot());
  }
  setAccount(accountId: string | null): void {
    if (accountId === this.state.accountId) return;
    this.generation++; this.busy = false;
    this.api = accountId ? this.apiForAccount(accountId) : null;
    this.state = empty(accountId); this.publish({});
  }
  async load(playlistId?: string): Promise<void> {
    if (!this.api || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try { await this.refresh(this.api, generation, playlistId); }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async refresh(api: LibraryApi, generation: number, playlistId?: string): Promise<boolean> {
    this.publish({ phase: 'loading', error: null });
    const [lists, likes, selected, entries] = await Promise.all([
      api.listPlaylists(), api.listLikedTracks(),
      playlistId ? api.getPlaylist(playlistId) : Promise.resolve(null),
      playlistId ? api.listPlaylistItems(playlistId) : Promise.resolve(null),
    ]);
    if (generation !== this.generation) return false;
    const gone = selected && !selected.ok && selected.error.code === 'NOT_FOUND';
    const failure = [lists, likes, ...(gone ? [] : [selected, entries])].find(value => value && !value.ok);
    if (failure && !failure.ok) { this.publish({ phase: 'error', error: failure.error }); return false; }
    if (!lists.ok || !likes.ok) return false;
    this.publish({ phase: 'ready', playlists: lists.value.items, likedTracks: likes.value.items,
      playlist: selected?.ok ? selected.value : null, items: !gone && entries?.ok ? entries.value.items : [],
      cursors: { playlists: lists.value.nextCursor, likes: likes.value.nextCursor, items: !gone && entries?.ok ? entries.value.nextCursor : null },
      error: null, failedAction: null, failedContext: null });
    return true;
  }
  async loadMore(kind: 'playlists' | 'likes' | 'items'): Promise<void> {
    if (!this.api || this.busy) return;
    const cursor = this.state.cursors[kind];
    if (!cursor) return;
    const generation = this.generation;
    this.busy = true;
    const response = kind === 'playlists' ? await this.api.listPlaylists(cursor)
      : kind === 'likes' ? await this.api.listLikedTracks(cursor)
      : await this.api.listPlaylistItems(this.state.playlist!.id, cursor);
    if (generation !== this.generation) return;
    this.busy = false;
    if (!response.ok) { this.publish({ phase: 'error', error: response.error }); return; }
    const key = kind === 'likes' ? 'likedTracks' : kind;
    this.publish({ [key]: [...this.state[key], ...response.value.items], cursors: { ...this.state.cursors, [kind]: response.value.nextCursor } });
  }
  async run(action: LibraryAction, retryContext?: MutationContext): Promise<Result<unknown>> {
    if (!this.api) return authFailure();
    if (this.busy) return { ok: false, error: { code: 'CONFLICT', message: 'Wait for the pending library request.', retryable: false } };
    const request = structuredClone(action);
    const api = this.api;
    const generation = this.generation;
    const collection = 'playlistId' in request ? (this.state.playlist?.id === request.playlistId ? this.state.playlist : this.state.playlists.find(p => p.id === request.playlistId)) : null;
    if ('playlistId' in request && !collection && !retryContext) return { ok: false, error: { code: 'NOT_FOUND', message: 'Load the playlist before editing.', retryable: false } };
    const context = retryContext ?? { mutationId: crypto.randomUUID(), expectedRevision: collection?.revision ?? 0 };
    this.busy = true;
    this.publish({ phase: 'mutation-pending', error: null, failedAction: null, failedContext: null });
    const response: Result<unknown> = await (request.type === 'create' ? api.createPlaylist(request.title, context.mutationId)
      : request.type === 'like' ? api.setTrackLiked(request.track, request.liked, context.mutationId)
      : request.type === 'likeSnapshot' ? api.setTrackLikeFromSnapshot(request.trackId, request.metadataSnapshot, request.liked, context.mutationId)
      : request.type === 'append' ? api.appendTrack(request.playlistId, request.track, context)
      : request.type === 'rename' ? api.renamePlaylist(request.playlistId, request.title, context)
      : request.type === 'remove' ? api.removePlaylistItem(request.playlistId, request.itemId, context)
      : request.type === 'reorder' ? api.reorderPlaylistItems(request.playlistId, request.itemIds, context)
      : api.deletePlaylist(request.playlistId, context));
    if (generation !== this.generation) return authFailure();
    const selected = request.type === 'delete' ? undefined : this.state.playlist?.id;
    const refreshed = await this.refresh(api, generation, selected);
    if (generation !== this.generation) return authFailure();
    this.busy = false;
    if (!response.ok) this.publish({ phase: refreshed && response.error.code === 'CONFLICT' ? 'conflict' : 'error',
      error: response.error, failedAction: request, failedContext: context });
    return response;
  }
  /** Explicit retry after CONFLICT uses freshly loaded revision and a new action ID.
   * retryUncertain() instead reuses the same ID for uncertain network writes.
   */
  retryConflict(): Promise<Result<unknown>> {
    if (this.state.phase !== 'conflict' || !this.state.failedAction) return Promise.resolve({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'No refreshed conflict is available to retry.', retryable: false } });
    return this.run(this.state.failedAction);
  }
  retryUncertain(): Promise<Result<unknown>> {
    if (!this.state.error?.retryable || !this.state.failedAction || !this.state.failedContext) {
      return Promise.resolve({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'No uncertain mutation is available to retry.', retryable: false } });
    }
    return this.run(this.state.failedAction, this.state.failedContext);
  }
}

export function createLibraryController(client: SupabaseClient<Database>, options: { pageSize?: number } = {}): { controller: LibraryController; dispose(): void } {
  const controller = new LibraryController(accountId => createLibraryApi(client, { ...options, accountId }));
  const { data } = client.auth.onAuthStateChange((_event, session) => { controller.setAccount(session?.user.id ?? null); });
  return { controller, dispose() { data.subscription.unsubscribe(); controller.setAccount(null); } };
}
