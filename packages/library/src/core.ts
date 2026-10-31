import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  LibraryError,
  type AddPlaylistItemInput,
  type Library,
  type Page,
  type Playlist,
  type PlaylistItem,
} from '@fyspoti/contracts';
import type { Database, ItemRow, PlaylistRow, Json } from './database.js';

export type { Database } from './database.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORDER = 2_147_483_647;

export function invalid(message: string): never {
  throw new LibraryError('INVALID_ARGUMENT', message);
}

export function checkId(value: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('Expected an app-owned UUID.');
}

/** PostgreSQL char_length counts Unicode code points, not UTF-16 code units. */
export function checkText(value: string, max: number, label: string): void {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || value.includes('\0')) {
    invalid(`${label} must contain 1–${max} characters.`);
  }
}

export function checkTrackId(value: string): void {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\s/\\]/u.test(value)
      || /^(https?:|file:|local:|p2-media:|spotify:|[a-z]:)/i.test(value)) invalid('Expected a canonical catalog track ID.');
}

function checkItem(item: AddPlaylistItemInput): void {
  checkTrackId(item.trackId);
  if (!Number.isInteger(item.orderingKey) || item.orderingKey < 0 || item.orderingKey > MAX_ORDER) {
    invalid('orderingKey must be a nonnegative 32-bit integer.');
  }
  const snapshot = item.metadataSnapshot;
  if (!snapshot) invalid('Track metadata is required.');
  checkText(snapshot.title, 500, 'Track title');
  if (!Array.isArray(snapshot.artistNames) || snapshot.artistNames.length < 1 || snapshot.artistNames.length > 50) {
    invalid('Expected 1–50 artist names.');
  }
  snapshot.artistNames.forEach(name => checkText(name, 500, 'Artist name'));
  if (!Number.isInteger(snapshot.durationMs) || snapshot.durationMs < 0 || snapshot.durationMs > 86_400_000) {
    invalid('durationMs must be an integer between 0 and 86400000.');
  }
}

type ProviderError = { code?: string; status?: number; message?: string };

/** Never expose provider messages, SQL details, tokens, or request bodies to consumers. */
export function translateError(error: unknown): LibraryError {
  if (error instanceof LibraryError) return error;
  const source = (error && typeof error === 'object' ? error : {}) as ProviderError;
  if (source.status === 401 || source.code === 'PT401' || source.code === 'PGRST301' || source.code === 'PGRST302' || source.code === 'PGRST303') {
    return new LibraryError('AUTH_REQUIRED', 'Sign in to access your library.');
  }
  if (source.status === 429 || source.code === 'over_request_rate_limit') {
    return new LibraryError('RATE_LIMITED', 'Library request rate exceeded.', true);
  }
  if (source.code === '23505' || source.code === 'PT409') return new LibraryError('CONFLICT', 'The playlist changed or the operation ID was already used. Refresh before retrying.');
  if (source.code === '23503' || source.code === 'PT404') return new LibraryError('NOT_FOUND', 'The requested playlist is unavailable.');
  if (source.code === '42501' || source.status === 403) return new LibraryError('FORBIDDEN', 'Library operation is not permitted.');
  if (source.code === '23514' || source.code === '22P02' || source.code === '23502' || source.code === 'PT400' || source.code === '22003') {
    return new LibraryError('INVALID_ARGUMENT', 'Invalid library data.');
  }
  return new LibraryError('UNAVAILABLE', 'The library service is unavailable.', true);
}

/** In-memory test/spike sessions only. No browser storage, URL tokens, or refresh timers. */
export function createMemoryClient(url: string, publishableKey: string, fetcher?: typeof fetch): SupabaseClient<Database> {
  if (publishableKey.startsWith('sb_secret_')) invalid('Use a publishable key, never a secret key.');
  // Legacy local CLI keys are JWTs. Reject service_role keys at the public boundary.
  if (publishableKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(publishableKey.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (payload.role === 'service_role') invalid('Use a publishable or local anon key.');
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      invalid('Invalid API key.');
    }
  }
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
  });
}

export async function signInWithPassword(client: SupabaseClient<Database>, email: string, password: string): Promise<void> {
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 400 || error.status === 422) throw new LibraryError('AUTH_REQUIRED', 'Sign-in failed.');
      throw error;
    }
  } catch (error) {
    throw translateError(error);
  }
}

type CursorValue = { v: 1; kind: 'playlists' | 'items' | 'likes'; owner: string; scope: string; last: string | number };

export function encodeCursor(value: CursorValue): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined, kind: CursorValue['kind'], owner: string, scope: string): CursorValue | null {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 1024) invalid('Invalid cursor.');
    const parsed = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))) as CursorValue;
    if (parsed.v !== 1 || parsed.kind !== kind || parsed.owner !== owner || parsed.scope !== scope) invalid('Invalid cursor scope.');
    if (kind === 'playlists' || kind === 'likes') checkId(parsed.last as string);
    else if (typeof parsed.last !== 'number' || !Number.isInteger(parsed.last) || parsed.last < 0 || parsed.last > MAX_ORDER) invalid('Invalid cursor position.');
    return parsed;
  } catch {
    return invalid('Invalid library cursor.');
  }
}

export function playlist(row: PlaylistRow): Playlist {
  return { id: row.id, ownerId: row.owner_id, title: row.title, visibility: row.visibility, createdAt: row.created_at, revision: row.revision };
}

export function playlistItem(row: ItemRow): PlaylistItem {
  return {
    id: row.id, playlistId: row.playlist_id, trackId: row.track_id, orderingKey: row.ordering_key,
    metadataSnapshot: { title: row.snapshot_title, artistNames: row.snapshot_artist_names, durationMs: row.snapshot_duration_ms },
  };
}

export async function requireOwner(client: SupabaseClient<Database>): Promise<string> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403) {
        throw new LibraryError('AUTH_REQUIRED', 'Sign in to access your library.');
      }
      throw error;
    }
    if (!data.user) throw new LibraryError('AUTH_REQUIRED', 'Sign in to access your library.');
    return data.user.id;
  } catch (error) { throw translateError(error); }
}

export async function executeMutation(client: SupabaseClient<Database>, operation: string, mutationId: string, payload: { [key: string]: Json | undefined }, expectedOwner?: string): Promise<Json> {
  checkId(mutationId);
  const owner = await requireOwner(client);
  if (expectedOwner && owner !== expectedOwner) throw new LibraryError('AUTH_REQUIRED', 'Account changed.');
  const { data, error, status } = await client.rpc('library_mutate', { operation, mutation_id: mutationId, payload: { ...payload, accountId: expectedOwner ?? owner } }).retry(false);
  if (error) throw translateError({ ...error, status });
  return data;
}

export function createLibrary(client: SupabaseClient<Database>, options: { pageSize?: number } = {}): Library {
  const pageSize = options.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) invalid('pageSize must be between 1 and 100.');

  async function authenticated<T>(operation: (owner: string) => Promise<T>): Promise<T> {
    try {
      return await operation(await requireOwner(client));
    } catch (error) {
      throw translateError(error);
    }
  }

  async function readPlaylist(id: string): Promise<Playlist> {
    const { data, error, status } = await client.from('playlists').select('*').eq('id', id).maybeSingle().retry(false);
    if (error) throw translateError({ ...error, status });
    if (!data) throw new LibraryError('NOT_FOUND', 'The requested playlist is unavailable.');
    return playlist(data);
  }

  function page<T>(rows: T[], cursor: (last: T) => CursorValue): Page<T> {
    const items = rows.slice(0, pageSize);
    return { items, nextCursor: rows.length > pageSize ? encodeCursor(cursor(items[items.length - 1]!)) : null };
  }

  return {
    async createPlaylist(title) {
      checkText(title, 200, 'Playlist title');
      return playlist(await executeMutation(client, 'create', crypto.randomUUID(), { title: title.trim() }) as unknown as PlaylistRow);
    },
    async listPlaylists(cursor) {
      return authenticated(async owner => {
        const after = decodeCursor(cursor, 'playlists', owner, 'library');
        let query = client.from('playlists').select('*').eq('owner_id', owner).order('id').limit(pageSize + 1);
        if (after) query = query.gt('id', after.last as string);
        const { data, error, status } = await query.retry(false);
        if (error) throw translateError({ ...error, status });
        return page(data.map(playlist), last => ({ v: 1, kind: 'playlists', owner, scope: 'library', last: last.id }));
      });
    },
    async getPlaylist(id) {
      checkId(id);
      return authenticated(() => readPlaylist(id));
    },
    async addPlaylistItem(playlistId, item) {
      checkId(playlistId);
      checkItem(item);
      return authenticated(async () => {
        const current = await readPlaylist(playlistId);
        const data = await executeMutation(client, 'insert_item', crypto.randomUUID(), {
          playlistId, expectedRevision: current.revision, trackId: item.trackId, orderingKey: item.orderingKey,
          metadataSnapshot: { ...item.metadataSnapshot },
        }) as unknown as { item: ItemRow };
        return playlistItem(data.item);
      });
    },
    async listPlaylistItems(playlistId, cursor) {
      checkId(playlistId);
      return authenticated(async owner => {
        const after = decodeCursor(cursor, 'items', owner, playlistId);
        await readPlaylist(playlistId);
        let query = client.from('playlist_items').select('*').eq('playlist_id', playlistId).order('ordering_key').limit(pageSize + 1);
        if (after) query = query.gt('ordering_key', after.last as number);
        const { data, error, status } = await query.retry(false);
        if (error) throw translateError({ ...error, status });
        return page(data.map(playlistItem), last => ({ v: 1, kind: 'items', owner, scope: playlistId, last: last.orderingKey }));
      });
    },
  };
}
