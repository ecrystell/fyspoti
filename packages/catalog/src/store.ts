import type { Album, Artist, ProviderRef, Track } from '@fyspoti/contracts';

/** A person's correction for one recording. It always beats the score. */
export interface MatchOverride {
  acceptSourceId?: string;
  rejectSourceIds?: string[];
}

/**
 * What the catalog has seen, by app ID. IDs cannot be reversed, so this is how a
 * track from an earlier search is found again. In memory until task 9 persists it.
 */
export interface CatalogStore {
  getTrack(id: string): Track | undefined;
  putTrack(track: Track): void;
  getAlbumName(id: string): string | undefined;
  getAlbum(id: string): Album | undefined;
  putAlbum(album: Album): void;
  getArtist(id: string): Artist | undefined;
  putArtist(artist: Artist): void;
  getOverride(trackId: string): MatchOverride | undefined;
  setOverride(trackId: string, override: MatchOverride): void;
  rememberAlbumRef(albumId: string, providerId: string, name?: string): void;
  albumRef(albumId: string): string | undefined;
  rememberArtistRef(artistId: string, providerId: string): void;
  artistRef(artistId: string): string | undefined;
}

// One recording can sit on several releases, so a repeat adds a source to the track.
const mergeRefs = (known: ProviderRef[], added: ProviderRef[]): ProviderRef[] => {
  const merged = [...known];
  for (const ref of added) {
    if (!merged.some((item) => item.provider === ref.provider && item.id === ref.id)) merged.push(ref);
  }
  return merged;
};

export function createMemoryCatalogStore(): CatalogStore {
  const tracks = new Map<string, Track>();
  const albums = new Map<string, Album>();
  const artists = new Map<string, Artist>();
  const overrides = new Map<string, MatchOverride>();
  const albumRefs = new Map<string, { providerId: string; name: string | undefined }>();
  const artistRefs = new Map<string, string>();

  return {
    getTrack: (id) => tracks.get(id),
    putTrack: (track) => {
      const known = tracks.get(track.id);
      tracks.set(track.id, known ? { ...track, providerRefs: mergeRefs(known.providerRefs, track.providerRefs) } : track);
    },
    getAlbumName: (id) => albums.get(id)?.title ?? albumRefs.get(id)?.name,
    getAlbum: (id) => albums.get(id),
    putAlbum: (album) => albums.set(album.id, album),
    getArtist: (id) => artists.get(id),
    putArtist: (artist) => artists.set(artist.id, artist),
    getOverride: (trackId) => overrides.get(trackId),
    setOverride: (trackId, override) => overrides.set(trackId, override),
    rememberAlbumRef: (albumId, providerId, name) => {
      albumRefs.set(albumId, { providerId, name: name ?? albumRefs.get(albumId)?.name });
    },
    albumRef: (albumId) => albumRefs.get(albumId)?.providerId,
    rememberArtistRef: (artistId, providerId) => artistRefs.set(artistId, providerId),
    artistRef: (artistId) => artistRefs.get(artistId),
  };
}
