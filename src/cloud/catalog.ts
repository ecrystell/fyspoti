import { Track, type TrackMetadataSnapshot } from '@fyspoti/contracts';
import { provisionalTrackId } from '@fyspoti/catalog';

export interface PreviewRecord { track: Track; preview?: string }
const queries = ['Vince Guaraldi The Great Pumpkin Waltz', 'Taylor Swift End Game', 'Hailee Steinfeld You’re Such A', 'Taylor Swift I Did Something Bad', 'James Arthur Say You Wont Let Go', 'Ariana Grande eternal sunshine', 'underscores Wallsocket', 'glaive all dogs go to heaven'];
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export async function fromItunes(raw: Record<string, unknown>): Promise<PreviewRecord | null> {
  if (!Number.isSafeInteger(raw.trackId) || Number(raw.trackId) <= 0) return null;
  const providerId = String(raw.trackId);
  const artistName = text(raw.artistName);
  const id = await provisionalTrackId(`itunes:track:${providerId}`);
  const artistId = await provisionalTrackId(`itunes:artist:${raw.artistId ?? artistName.normalize('NFC')}`);
  const artwork = text(raw.artworkUrl100).replace('100x100bb', '600x600bb');
  const parsed = Track.safeParse({ id, title: text(raw.trackName), artists: [{ id: artistId, name: artistName }],
    albumId: raw.collectionId ? await provisionalTrackId(`itunes:album:${String(raw.collectionId)}`) : null,
    durationMs: raw.trackTimeMillis, explicit: raw.trackExplicitness === 'explicit' ? 'explicit' : raw.trackExplicitness === 'notExplicit' ? 'not-explicit' : 'unknown',
    versionFlags: [], artwork: /^https:\/\/[^/]+\.mzstatic\.com\//.test(artwork) ? [{ url: artwork }] : [], providerRefs: [{ provider: 'itunes', id: providerId }],
  });
  if (!parsed.success) return null;
  const preview = text(raw.previewUrl);
  return { track: parsed.data, ...(/^https:\/\/[^/]+\.itunes\.apple\.com\//.test(preview) ? { preview } : {}) };
}
export async function loadPreviewCatalog(signal: AbortSignal): Promise<PreviewRecord[]> {
  const records = await Promise.all(queries.map(async query => {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error('Catalog unavailable');
    const data = await response.json() as { results?: Record<string, unknown>[] };
    return data.results?.[0] ? fromItunes(data.results[0]) : null;
  }));
  return [...new Map(records.filter((record): record is PreviewRecord => Boolean(record)).map(record => [record.track.id, record])).values()];
}
export function metadata(track: Track): TrackMetadataSnapshot {
  return { title: track.title, artistNames: track.artists.map(artist => artist.name), durationMs: track.durationMs };
}
