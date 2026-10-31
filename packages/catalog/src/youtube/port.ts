import { z } from 'zod';

export const YTMUSIC_PROVIDER = 'youtube-music';

const Thumbnail = z.object({ url: z.string().nullish(), width: z.number().nullish(), height: z.number().nullish() });
const ArtistRef = z.object({ name: z.string().nullish(), id: z.string().nullish() });

// Unofficial data can change without notice, so every field is checked at the boundary.
export const TrackRow = z.object({
  videoId: z.string().nullish(),
  title: z.string().nullish(),
  videoType: z.string().nullish(),
  artists: z.array(ArtistRef),
  albumName: z.string().nullish(),
  albumId: z.string().nullish(),
  durationSeconds: z.number().nullish(),
  isExplicit: z.boolean().nullish(),
  thumbnails: z.array(Thumbnail),
});
export type TrackRow = z.infer<typeof TrackRow>;

export const AlbumRow = z.object({
  browseId: z.string().nullish(),
  title: z.string().nullish(),
  type: z.string().nullish(),
  year: z.string().nullish(),
  artists: z.array(ArtistRef),
  isExplicit: z.boolean().nullish(),
  thumbnails: z.array(Thumbnail),
});
export type AlbumRow = z.infer<typeof AlbumRow>;

export const AlbumDetail = AlbumRow.extend({ tracks: z.array(TrackRow) });
export type AlbumDetail = z.infer<typeof AlbumDetail>;

export const ArtistRow = z.object({ browseId: z.string().nullish(), name: z.string().nullish(), thumbnails: z.array(Thumbnail) });
export type ArtistRow = z.infer<typeof ArtistRow>;

export const PlaylistRow = z.object({
  playlistId: z.string().nullish(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  thumbnails: z.array(Thumbnail),
});
export type PlaylistRow = z.infer<typeof PlaylistRow>;

export const HomeShelfRow = z.object({
  title: z.string().nullish(),
  items: z.array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('track'), row: TrackRow }),
      z.object({ kind: z.literal('album'), row: AlbumRow }),
      z.object({ kind: z.literal('playlist'), row: PlaylistRow }),
    ]),
  ),
});
export type HomeShelfRow = z.infer<typeof HomeShelfRow>;

export const MoodRow = z.object({ group: z.string().nullish(), title: z.string().nullish(), params: z.string().nullish() });
export type MoodRow = z.infer<typeof MoodRow>;

/** Failures reject with a ProviderFailure so the catalog can turn them into a Result. */
export class ProviderFailure extends Error {
  public readonly kind: 'rate-limited' | 'network' | 'provider' | 'cancelled';
  public readonly retryAfterMs: number | undefined;

  constructor(kind: ProviderFailure['kind'], message: string, retryAfterMs?: number) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.name = 'ProviderFailure';
  }
}

/** The YouTube Music calls the catalog needs. Tests use a fake with invented rows. */
export interface YtMusicPort {
  searchTracks(query: string, filter: 'songs' | 'videos', limit: number, signal?: AbortSignal): Promise<TrackRow[]>;
  searchAlbums(query: string, limit: number, signal?: AbortSignal): Promise<AlbumRow[]>;
  searchArtists(query: string, limit: number, signal?: AbortSignal): Promise<ArtistRow[]>;
  album(browseId: string, signal?: AbortSignal): Promise<AlbumDetail>;
  artist(browseId: string, signal?: AbortSignal): Promise<ArtistRow>;
  relatedArtists(browseId: string, signal?: AbortSignal): Promise<ArtistRow[]>;
  radio(videoId: string, limit: number, signal?: AbortSignal): Promise<TrackRow[]>;
  home(limit: number, signal?: AbortSignal): Promise<HomeShelfRow[]>;
  moods(signal?: AbortSignal): Promise<MoodRow[]>;
  moodPlaylists(params: string, signal?: AbortSignal): Promise<PlaylistRow[]>;
  playlist(playlistId: string, limit: number, signal?: AbortSignal): Promise<TrackRow[]>;
  suggestions(query: string, signal?: AbortSignal): Promise<string[]>;
}
