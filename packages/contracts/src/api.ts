import type { Album, Artist, Recommendation, RecommendationContext, SearchHit, Track } from './catalog.ts';
import type { MatchResult } from './candidates.ts';
import type { Cursor, Page, Result } from './common.ts';

export type RequestOptions = { signal?: AbortSignal };

// The catalog boundary from docs/01-architecture.md. Every method resolves; failures
// arrive as a Result so a rate limit cannot look like an empty library.
export interface CatalogApi {
  search(query: string, cursor: Cursor | null, options?: RequestOptions): Promise<Result<Page<SearchHit>>>;
  getTrack(trackId: string, options?: RequestOptions): Promise<Result<Track>>;
  getAlbum(albumId: string, options?: RequestOptions): Promise<Result<Album>>;
  getArtist(artistId: string, options?: RequestOptions): Promise<Result<Artist>>;
  getRecommendations(context: RecommendationContext, cursor: Cursor | null, options?: RequestOptions): Promise<Result<Page<Recommendation>>>;
  // 'no-match' is a normal MatchResult, not an error. The NO_MATCH code is for
  // callers such as play() that needed a candidate and could not get one.
  findCandidates(trackId: string, options?: RequestOptions): Promise<Result<MatchResult>>;
}
