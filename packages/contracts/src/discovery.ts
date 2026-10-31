import { z } from 'zod';
import type { FindCandidatesOptions, RequestOptions } from './api.ts';
import { Album, AppId, Artist, Track } from './catalog.ts';
import type { RecommendationContext } from './catalog.ts';
import { Artwork } from './common.ts';
import type { Cursor, Page, Result } from './common.ts';

export const TimedLyricLine = z.strictObject({
  startMs: z.number().int().nonnegative(),
  text: z.string(), // Empty marks a gap, so the current line can clear during a solo.
});
export type TimedLyricLine = z.infer<typeof TimedLyricLine>;

// From docs/12-lyrics-and-visuals.md. Lyrics belong to their rights holders, so this
// is display-only: permissions say what else the app may do with it.
export const LyricsDocument = z.strictObject({
  trackId: AppId,
  language: z.string().min(1).nullable(),
  plainLines: z.array(z.string()),
  // Null when there are none, or when they may not fit this recording's length.
  timedLines: z.array(TimedLyricLine).nullable(),
  instrumental: z.boolean(),
  provenance: z.strictObject({ provider: z.string().min(1), providerId: z.string().min(1).optional() }),
  permissions: z.strictObject({ storeOnDisk: z.boolean(), share: z.boolean() }),
  revision: z.string().min(1),
});
export type LyricsDocument = z.infer<typeof LyricsDocument>;

// A provider playlist or mood is not an app entity, so it has an opaque ref rather
// than an AppId. Refs may expire, and must not be saved to a library or synced.
export const BrowsePlaylist = z.strictObject({
  ref: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  artwork: z.array(Artwork),
});
export type BrowsePlaylist = z.infer<typeof BrowsePlaylist>;

export const ShelfItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('track'), track: Track }),
  z.strictObject({ kind: z.literal('album'), album: Album }),
  z.strictObject({ kind: z.literal('playlist'), playlist: BrowsePlaylist }),
]);
export type ShelfItem = z.infer<typeof ShelfItem>;

export const BrowseShelf = z.strictObject({
  title: z.string().min(1),
  items: z.array(ShelfItem).min(1),
});
export type BrowseShelf = z.infer<typeof BrowseShelf>;

export const MoodCategory = z.strictObject({
  ref: z.string().min(1),
  title: z.string().min(1),
  group: z.string().min(1), // Such as "Moods & moments" or "Genres".
});
export type MoodCategory = z.infer<typeof MoodCategory>;

export type ContentFilter = Pick<RecommendationContext, 'filterExplicit' | 'excludedTrackIds' | 'blockedArtistIds'>;

// Beyond the catalog boundary in docs/01-architecture.md. Same rules: every method
// resolves, and failures arrive as a Result.
export interface DiscoveryApi {
  /** A null value means this track has no lyrics, which is not an error. */
  getLyrics(trackId: string, options?: FindCandidatesOptions): Promise<Result<LyricsDocument | null>>;
  getSuggestions(query: string, options?: RequestOptions): Promise<Result<string[]>>;
  getHomeShelves(filter: ContentFilter, options?: RequestOptions): Promise<Result<BrowseShelf[]>>;
  getMoods(options?: RequestOptions): Promise<Result<MoodCategory[]>>;
  getMoodPlaylists(ref: string, options?: RequestOptions): Promise<Result<BrowsePlaylist[]>>;
  getPlaylistTracks(ref: string, filter: ContentFilter, cursor: Cursor | null, options?: RequestOptions): Promise<Result<Page<Track>>>;
  getRelatedArtists(artistId: string, options?: RequestOptions): Promise<Result<Artist[]>>;
}
