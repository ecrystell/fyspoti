import { z } from 'zod';
import type { CatalogApi, RequestOptions } from '../api.ts';
import { MatchResult } from '../candidates.ts';
import { Album, Artist, Recommendation, RecommendationContext, Track } from '../catalog.ts';
import type { SearchHit } from '../catalog.ts';
import type { AppError, Cursor, Page, Result } from '../common.ts';

export const CatalogFixtures = z.strictObject({
  artists: z.array(Artist),
  albums: z.array(Album),
  tracks: z.array(Track),
  matches: z.array(MatchResult),
  recommendations: z.array(z.strictObject({ trackId: z.string().min(1), reason: z.string().min(1) })),
});
export type CatalogFixtures = z.infer<typeof CatalogFixtures>;

export const RATE_LIMITED_QUERY = 'simulate:rate-limit';

const fail = (error: AppError): { ok: false; error: AppError } => ({ ok: false, error });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

const encodeCursor = (offset: number): Cursor => Buffer.from(JSON.stringify({ offset })).toString('base64url');
const decodeCursor = (cursor: Cursor | null): number =>
  cursor === null ? 0 : (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { offset: number }).offset;

function paginate<T>(items: T[], cursor: Cursor | null, pageSize: number): Page<T> {
  const offset = decodeCursor(cursor);
  const end = offset + pageSize;
  return { items: items.slice(offset, end), nextCursor: end < items.length ? encodeCursor(end) : null };
}

const cancelled = (options?: RequestOptions): Result<never> | null =>
  options?.signal?.aborted ? fail({ code: 'CANCELLED', message: 'Request was cancelled', retryable: false }) : null;

const notFound = (kind: string, id: string): Result<never> =>
  fail({ code: 'UNAVAILABLE', message: `Unknown ${kind}: ${id}`, retryable: false });

// A fixture-backed CatalogApi so consumers can build before real adapters exist.
export function createMockCatalog(fixtures: CatalogFixtures, { pageSize = 2 } = {}): CatalogApi {
  const trackById = new Map(fixtures.tracks.map((track) => [track.id, track]));

  return {
    async search(query, cursor, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      if (query === RATE_LIMITED_QUERY) {
        return fail({ code: 'RATE_LIMITED', message: 'Provider rate limit reached', retryable: true, retryAfterMs: 1000, provider: 'mock' });
      }
      const needle = query.trim().toLowerCase();
      const hits: SearchHit[] = [
        ...fixtures.tracks
          .filter((track) => `${track.title} ${track.artists.map((artist) => artist.name).join(' ')}`.toLowerCase().includes(needle))
          .map((track) => ({ kind: 'track' as const, track })),
        ...fixtures.albums.filter((album) => album.title.toLowerCase().includes(needle)).map((album) => ({ kind: 'album' as const, album })),
        ...fixtures.artists.filter((artist) => artist.name.toLowerCase().includes(needle)).map((artist) => ({ kind: 'artist' as const, artist })),
      ];
      return ok(paginate(hits, cursor, pageSize));
    },

    async getTrack(trackId, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      const track = trackById.get(trackId);
      return track ? ok(track) : notFound('track', trackId);
    },

    async getAlbum(albumId, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      const album = fixtures.albums.find((item) => item.id === albumId);
      return album ? ok(album) : notFound('album', albumId);
    },

    async getArtist(artistId, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      const artist = fixtures.artists.find((item) => item.id === artistId);
      return artist ? ok(artist) : notFound('artist', artistId);
    },

    async getRecommendations(context, cursor, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      const parsed = RecommendationContext.parse(context);
      const allowed = fixtures.recommendations.flatMap((item) => {
        const track = trackById.get(item.trackId);
        if (!track || parsed.excludedTrackIds.includes(track.id)) return [];
        if (track.artists.some((artist) => parsed.blockedArtistIds.includes(artist.id))) return [];
        if (parsed.filterExplicit && track.explicit !== 'not-explicit') return [];
        return [Recommendation.parse({ track, reason: item.reason })];
      });
      return ok(paginate(allowed, cursor, pageSize));
    },

    async findCandidates(trackId, options) {
      const stopped = cancelled(options);
      if (stopped) return stopped;
      if (!trackById.has(trackId)) return notFound('track', trackId);
      const match = fixtures.matches.find((item) => item.trackId === trackId);
      return ok(match ?? { status: 'no-match', trackId, rejected: [], reasons: [{ signal: 'no-results', detail: 'No candidates in fixtures' }] });
    },
  };
}
