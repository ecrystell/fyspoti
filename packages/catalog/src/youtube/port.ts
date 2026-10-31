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
  thumbnails: z.array(Thumbnail),
});
export type AlbumRow = z.infer<typeof AlbumRow>;

export const AlbumDetail = AlbumRow.extend({ tracks: z.array(TrackRow) });
export type AlbumDetail = z.infer<typeof AlbumDetail>;

export const ArtistRow = z.object({ browseId: z.string().nullish(), name: z.string().nullish(), thumbnails: z.array(Thumbnail) });
export type ArtistRow = z.infer<typeof ArtistRow>;

export type SearchRequest =
  | { filter: 'songs' | 'videos'; rows: TrackRow }
  | { filter: 'albums'; rows: AlbumRow }
  | { filter: 'artists'; rows: ArtistRow };

/** Failures reject with a ProviderFailure so the catalog can turn them into a Result. */
export class ProviderFailure extends Error {
  public readonly kind: 'rate-limited' | 'network' | 'provider' | 'cancelled';

  constructor(kind: ProviderFailure['kind'], message: string) {
    super(message);
    this.kind = kind;
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
}
