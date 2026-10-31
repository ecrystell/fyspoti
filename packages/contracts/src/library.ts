import type { Cursor, Page, Result } from './common.ts';
import type { Track } from './catalog.ts';

/** App-owned UUIDs; catalog providers and stream URLs never define track identity. */
export type EntityId = string;

export interface Playlist {
  id: EntityId;
  ownerId: EntityId;
  title: string;
  visibility: 'private';
  createdAt: string;
  revision: number;
}

export interface TrackMetadataSnapshot {
  title: string;
  artistNames: string[];
  durationMs: number;
}

export interface PlaylistItem {
  id: EntityId;
  playlistId: EntityId;
  trackId: EntityId;
  orderingKey: number;
  metadataSnapshot: TrackMetadataSnapshot;
}

/** Explicit integer positions for M0; append/reorder/conflict handling arrives later. */
export interface AddPlaylistItemInput {
  trackId: EntityId;
  orderingKey: number;
  metadataSnapshot: TrackMetadataSnapshot;
}

export type LibraryErrorCode =
  | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'NO_MATCH'
  | 'CONFLICT' | 'DISK_FULL' | 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'FORBIDDEN';

export class LibraryError extends Error {
  public readonly code: LibraryErrorCode;
  public readonly retryable: boolean;

  constructor(code: LibraryErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = 'LibraryError';
  }
}

export interface Library {
  createPlaylist(title: string): Promise<Playlist>;
  listPlaylists(cursor?: Cursor): Promise<Page<Playlist>>;
  /** Returns NOT_FOUND for both missing and another account's private playlists. */
  getPlaylist(id: EntityId): Promise<Playlist>;
  addPlaylistItem(playlistId: EntityId, item: AddPlaylistItemInput): Promise<PlaylistItem>;
  listPlaylistItems(playlistId: EntityId, cursor?: Cursor): Promise<Page<PlaylistItem>>;
}

export interface MutationContext {
  mutationId: string;
  expectedRevision: number;
}

export interface TrackLike {
  id: string | null;
  trackId: string;
  liked: boolean;
  revision: number;
  metadataSnapshot: TrackMetadataSnapshot | null;
}

export interface ItemMutation {
  playlist: Playlist;
  item: PlaylistItem;
}

/** New consumer boundary: failures are serializable data, including validation errors. */
export interface LibraryApi {
  createPlaylist(title: string, mutationId: string): Promise<Result<Playlist>>;
  listPlaylists(cursor?: Cursor): Promise<Result<Page<Playlist>>>;
  getPlaylist(id: string): Promise<Result<Playlist>>;
  listPlaylistItems(playlistId: string, cursor?: Cursor): Promise<Result<Page<PlaylistItem>>>;
  setTrackLiked(track: Track, liked: boolean, mutationId: string): Promise<Result<TrackLike>>;
  getTrackLike(trackId: string): Promise<Result<TrackLike>>;
  listLikedTracks(cursor?: Cursor): Promise<Result<Page<TrackLike>>>;
  appendTrack(playlistId: string, track: Track, context: MutationContext): Promise<Result<ItemMutation>>;
  renamePlaylist(playlistId: string, title: string, context: MutationContext): Promise<Result<Playlist>>;
  removePlaylistItem(playlistId: string, itemId: string, context: MutationContext): Promise<Result<Playlist>>;
  reorderPlaylistItems(playlistId: string, itemIds: string[], context: MutationContext): Promise<Result<Playlist>>;
  deletePlaylist(playlistId: string, context: MutationContext): Promise<Result<{ id: string; revision: number }>>;
}
