import { Album, Track } from '@fyspoti/contracts';
import { provisionalTrackId, rowIdentityKey, uuidV5 } from '@fyspoti/catalog';

// Interim P1 adapter until P4 ships a CatalogApi implementation. It turns a fixed
// set of iTunes Search results into shared contract records. Preview URLs are kept
// beside the records because a Track must never carry a stream URL.

export interface CatalogEntry {
  track: Track;
  album: Album;
  /** 30-second Apple preview. Device-local cache only; never synced or used as identity. */
  preview?: string;
}

const FEATURED_QUERIES = ['Vince Guaraldi The Great Pumpkin Waltz', 'Taylor Swift End Game', 'Hailee Steinfeld You’re Such A', 'Taylor Swift I Did Something Bad', 'James Arthur Say You Wont Let Go', 'Ariana Grande eternal sunshine', 'underscores Wallsocket', 'glaive all dogs go to heaven'];
const CACHE_KEY = 'fy-catalog-v2';
// Albums and artists are not stored by P3, so they only need to be stable here.
const INTERIM_NAMESPACE = '5b0e7a3c-2f4d-4c1e-9a6b-8d3f1e2c7a90';

type ItunesSong = {
  trackId: number; trackName: string; artistId: number; artistName: string;
  collectionId: number; collectionName: string; artworkUrl100: string; previewUrl?: string;
  trackTimeMillis: number; trackViewUrl?: string; collectionViewUrl?: string;
  trackExplicitness?: string; releaseDate?: string;
};

const previews = new Map<string, string>();

async function toEntry(song: ItunesSong): Promise<CatalogEntry | null> {
  // Same text identity key as P4's export importer, so an older Spotify export row
  // for this recording receives the same provisional ID.
  const id = await provisionalTrackId(rowIdentityKey({ position: 0, uri: null, title: song.trackName, artistName: song.artistName, albumName: song.collectionName }));
  const artist = { id: await uuidV5(INTERIM_NAMESPACE, 'itunes:artist:' + song.artistId), name: song.artistName };
  const albumId = await uuidV5(INTERIM_NAMESPACE, 'itunes:album:' + song.collectionId);
  const artwork = [{ url: song.artworkUrl100.replace('100x100bb', '600x600bb'), widthPx: 600, heightPx: 600 }];
  const track = Track.safeParse({
    id, title: song.trackName, artists: [artist], albumId, durationMs: song.trackTimeMillis,
    explicit: song.trackExplicitness === 'explicit' ? 'explicit' : song.trackExplicitness ? 'not-explicit' : 'unknown',
    versionFlags: [], artwork,
    providerRefs: [{ provider: 'itunes', id: String(song.trackId), ...(song.trackViewUrl ? { url: song.trackViewUrl } : {}) }],
  });
  const album = Album.safeParse({
    id: albumId, title: song.collectionName, artists: [artist], kind: 'album',
    ...(song.releaseDate ? { releaseDate: song.releaseDate.slice(0, 10) } : {}),
    trackIds: [id], artwork,
    providerRefs: [{ provider: 'itunes', id: String(song.collectionId), ...(song.collectionViewUrl ? { url: song.collectionViewUrl } : {}) }],
  });
  // Provider data is untrusted: a record that fails the shared schema is dropped.
  if (!track.success || !album.success) return null;
  return { track: track.data, album: album.data, ...(song.previewUrl?.startsWith('https://') ? { preview: song.previewUrl } : {}) };
}

function remember(entries: CatalogEntry[]): CatalogEntry[] {
  for (const entry of entries) if (entry.preview) previews.set(entry.track.id, entry.preview);
  return entries;
}

export function cachedFeatured(): CatalogEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]') as CatalogEntry[];
    return remember(saved.filter(entry => Track.safeParse(entry.track).success && Album.safeParse(entry.album).success));
  } catch {
    return [];
  }
}

export async function loadFeatured(): Promise<CatalogEntry[]> {
  const songs = await Promise.all(FEATURED_QUERIES.map(async query => {
    const response = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&entity=song&limit=1');
    if (!response.ok) throw new Error('Catalog unavailable');
    return ((await response.json()) as { results: ItunesSong[] }).results[0];
  }));
  const entries = (await Promise.all(songs.filter(Boolean).map(song => toEntry(song!)))).filter((entry): entry is CatalogEntry => Boolean(entry));
  if (!entries.length) throw new Error('No catalog results');
  localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  return remember(entries);
}

export function previewFor(trackId: string): string | undefined {
  return previews.get(trackId);
}
