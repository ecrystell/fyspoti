/** App-owned UUIDs; catalog providers and stream URLs never define track identity. */
export type EntityId = string;
export type Cursor = string;

export interface Playlist {
  id: EntityId;
  ownerId: EntityId;
  title: string;
  visibility: 'private';
  createdAt: string;
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

export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
}

export type LibraryErrorCode =
  | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'NO_MATCH'
  | 'CONFLICT' | 'DISK_FULL' | 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'FORBIDDEN';

export class LibraryError extends Error {
  constructor(
    public readonly code: LibraryErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
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
