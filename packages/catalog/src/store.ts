import { Album, Artist, MatchResult, Track, type ProviderRef } from '@fyspoti/contracts';
import { z } from 'zod';

/** A person's correction for one recording. It always beats the score. */
export interface MatchOverride {
  acceptSourceId?: string;
  rejectSourceIds?: string[];
}

export interface CachedMatch {
  match: MatchResult;
  savedAt: number;
}

/**
 * What the catalog has seen, by app ID. IDs cannot be reversed, so this is how a
 * track from an earlier search is found again.
 */
export interface CatalogStore {
  getTrack(id: string): Track | undefined;
  putTrack(track: Track): void;
  getAlbumName(id: string): string | undefined;
  getAlbum(id: string): Album | undefined;
  putAlbum(album: Album): void;
  getArtist(id: string): Artist | undefined;
  putArtist(artist: Artist): void;
  /** When a track, album or artist was last saved. */
  savedAt(id: string): number | undefined;
  getMatch(trackId: string): CachedMatch | undefined;
  putMatch(trackId: string, match: MatchResult): void;
  getOverride(trackId: string): MatchOverride | undefined;
  /** Also drops any cached match, which the correction has made out of date. */
  setOverride(trackId: string, override: MatchOverride): void;
  rememberAlbumRef(albumId: string, providerId: string, name?: string): void;
  albumRef(albumId: string): string | undefined;
  rememberArtistRef(artistId: string, providerId: string): void;
  artistRef(artistId: string): string | undefined;
}

const SNAPSHOT_VERSION = 1;
const MAX_ENTRIES = 50_000;

interface Stamped<T> {
  value: T;
  savedAt: number;
}

const Entry = z.object({ id: z.string(), value: z.unknown(), savedAt: z.number() });
const Override = z.object({ acceptSourceId: z.string().optional(), rejectSourceIds: z.array(z.string()).optional() });
const AlbumRef = z.object({ providerId: z.string(), name: z.string().optional() });

const Snapshot = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  tracks: z.array(Entry),
  albums: z.array(Entry),
  artists: z.array(Entry),
  matches: z.array(Entry),
  overrides: z.array(z.tuple([z.string(), Override])),
  albumRefs: z.array(z.tuple([z.string(), AlbumRef])),
  artistRefs: z.array(z.tuple([z.string(), z.string()])),
});
export type CatalogSnapshot = z.infer<typeof Snapshot>;

/** Null when the whole snapshot is unusable, such as one from a newer app version. */
export const parseCatalogSnapshot = (raw: unknown): CatalogSnapshot | null => {
  const parsed = Snapshot.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export interface MemoryStoreOptions {
  now?: () => number;
  initial?: CatalogSnapshot | null;
  onChange?: () => void;
  /** Per kind. The oldest go first, and corrections are never dropped. */
  maxEntries?: number;
}

export interface SnapshotCatalogStore extends CatalogStore {
  snapshot(): CatalogSnapshot;
}

// One recording can sit on several releases, so a repeat adds a source to the track.
const mergeRefs = (known: ProviderRef[], added: ProviderRef[]): ProviderRef[] => {
  const merged = [...known];
  for (const ref of added) {
    if (!merged.some((item) => item.provider === ref.provider && item.id === ref.id)) merged.push(ref);
  }
  return merged;
};

// A record from an older schema is dropped alone: it can be fetched again, and one
// bad row must not cost someone the whole cache.
function restore<T>(entries: CatalogSnapshot['tracks'] | undefined, schema: z.ZodType<T>): Map<string, Stamped<T>> {
  const restored = new Map<string, Stamped<T>>();
  for (const { id, value, savedAt } of [...(entries ?? [])].sort((a, b) => a.savedAt - b.savedAt)) {
    const parsed = schema.safeParse(value);
    if (parsed.success) restored.set(id, { value: parsed.data, savedAt });
  }
  return restored;
}

const entriesOf = <T>(items: Map<string, Stamped<T>>): CatalogSnapshot['tracks'] => [...items].map(([id, { value, savedAt }]) => ({ id, value, savedAt }));

const withoutUndefined = (override: z.infer<typeof Override>): MatchOverride => ({
  ...(override.acceptSourceId === undefined ? {} : { acceptSourceId: override.acceptSourceId }),
  ...(override.rejectSourceIds === undefined ? {} : { rejectSourceIds: override.rejectSourceIds }),
});

export function createMemoryCatalogStore({ now = Date.now, initial, onChange, maxEntries = MAX_ENTRIES }: MemoryStoreOptions = {}): SnapshotCatalogStore {
  const tracks = restore(initial?.tracks, Track);
  const albums = restore(initial?.albums, Album);
  const artists = restore(initial?.artists, Artist);
  const matches = restore(initial?.matches, MatchResult);
  const overrides = new Map<string, MatchOverride>((initial?.overrides ?? []).map(([id, override]) => [id, withoutUndefined(override)]));
  const albumRefs = new Map<string, { providerId: string; name?: string }>(
    (initial?.albumRefs ?? []).map(([id, { providerId, name }]) => [id, { providerId, ...(name === undefined ? {} : { name }) }]),
  );
  const artistRefs = new Map<string, string>(initial?.artistRefs);

  // Maps keep insertion order, and a re-saved key moves to the end, so the first key
  // is always the oldest.
  const trim = <V>(items: Map<string, V>): void => {
    while (items.size > maxEntries) items.delete(items.keys().next().value as string);
  };
  const put = <T>(items: Map<string, Stamped<T>>, id: string, value: T): void => {
    items.delete(id);
    items.set(id, { value, savedAt: now() });
    trim(items);
    onChange?.();
  };
  const refresh = <V>(items: Map<string, V>, id: string, value: V): void => {
    items.delete(id);
    items.set(id, value);
    trim(items);
    onChange?.();
  };

  return {
    getTrack: (id) => tracks.get(id)?.value,
    putTrack: (track) => {
      const known = tracks.get(track.id)?.value;
      put(tracks, track.id, known ? { ...track, providerRefs: mergeRefs(known.providerRefs, track.providerRefs) } : track);
    },
    getAlbumName: (id) => albums.get(id)?.value.title ?? albumRefs.get(id)?.name,
    getAlbum: (id) => albums.get(id)?.value,
    putAlbum: (album) => put(albums, album.id, album),
    getArtist: (id) => artists.get(id)?.value,
    putArtist: (artist) => put(artists, artist.id, artist),
    savedAt: (id) => (tracks.get(id) ?? albums.get(id) ?? artists.get(id))?.savedAt,
    getMatch: (trackId) => {
      const cached = matches.get(trackId);
      return cached && { match: cached.value, savedAt: cached.savedAt };
    },
    putMatch: (trackId, match) => put(matches, trackId, match),
    getOverride: (trackId) => overrides.get(trackId),
    setOverride: (trackId, override) => {
      overrides.set(trackId, override);
      matches.delete(trackId);
      onChange?.();
    },
    rememberAlbumRef: (albumId, providerId, name) => {
      const known = name ?? albumRefs.get(albumId)?.name;
      refresh(albumRefs, albumId, { providerId, ...(known === undefined ? {} : { name: known }) });
    },
    albumRef: (albumId) => albumRefs.get(albumId)?.providerId,
    rememberArtistRef: (artistId, providerId) => refresh(artistRefs, artistId, providerId),
    artistRef: (artistId) => artistRefs.get(artistId),
    snapshot: () => ({
      version: SNAPSHOT_VERSION,
      tracks: entriesOf(tracks),
      albums: entriesOf(albums),
      artists: entriesOf(artists),
      matches: entriesOf(matches),
      overrides: [...overrides],
      albumRefs: [...albumRefs],
      artistRefs: [...artistRefs],
    }),
  };
}
