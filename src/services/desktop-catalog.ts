import type { Album, AppError, Artist, Cursor, MatchResult, Page, Result, SearchHit, Track, TrackHint } from '@fyspoti/contracts';

// Renderer view of P4's catalog. It runs in Electron main (it owns a Python worker),
// so the renderer reaches it only through this preload bridge. Every call resolves to
// a Result, so a rate limit or outage can never look like "no results".
export interface CatalogBridge {
  search(query: string, cursor: Cursor | null): Promise<Result<Page<SearchHit>>>;
  getTrack(trackId: string): Promise<Result<Track>>;
  getAlbum(albumId: string): Promise<Result<Album>>;
  getArtist(artistId: string): Promise<Result<Artist>>;
  findCandidates(trackId: string, hint?: TrackHint): Promise<Result<MatchResult>>;
  /** Apple's most-played albums chart for a country (main-process fetch; the feed has no CORS). */
  topAlbums(country: string, limit: number): Promise<TopAlbumsResult>;
}

export interface TopAlbum { name: string; artistName: string; art: string; releaseDate?: string; url?: string }
export type TopAlbumsResult = { ok: true; value: { updated: string; country: string; albums: TopAlbum[] } } | { ok: false; error: { code: 'UNAVAILABLE'; message: string; retryable: true } };

// Typed locally: the Electron preload also compiles this file, without the renderer's Window globals.
export const desktopCatalog = (): CatalogBridge | undefined => (window as { desktop?: { catalog?: CatalogBridge } }).desktop?.catalog;

const messages: Partial<Record<AppError['code'], string>> = {
  RATE_LIMITED: 'The music catalog is busy. Try again in a moment.',
  UNAVAILABLE: 'The music catalog is unavailable. Check your connection and retry.',
  CANCELLED: 'The request was cancelled.',
};

/** Provider messages stay in logs; people see a stable sentence per error code. */
export const describeCatalogError = (error: AppError): string => messages[error.code] ?? 'The music catalog could not complete that request.';
