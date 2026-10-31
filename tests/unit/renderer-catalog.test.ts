import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Track } from '@fyspoti/contracts';
import { provisionalTrackId, rowIdentityKey } from '@fyspoti/catalog';
import { cachedFeatured, loadFeatured, previewFor } from '../../src/services/catalog.js';

// Synthetic iTunes-shaped results: invented names, IDs and URLs.
const song = (n: number, previewUrl?: string) => ({
  trackId: 1000 + n, trackName: `Fixture Song ${n}`, artistId: 2000, artistName: 'Fixture Artist',
  collectionId: 3000 + n, collectionName: `Fixture Album ${n}`,
  artworkUrl100: `https://example.test/art/${n}/100x100bb.jpg`, trackTimeMillis: 180_000 + n,
  trackViewUrl: `https://example.test/track/${n}`, trackExplicitness: 'notExplicit', releaseDate: '2020-01-02T00:00:00Z',
  ...(previewUrl ? { previewUrl } : {}),
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('renderer interim catalog adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const results = call === 1 ? [song(1, 'https://example.test/preview/1.m4a')] : call === 2 ? [song(2, 'http://example.test/insecure.m4a')] : [];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('produces contract-valid tracks without stream URLs', async () => {
    const entries = await loadFeatured();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(Track.parse(entry.track)).toEqual(entry.track);
      expect(JSON.stringify(entry.track)).not.toContain('preview');
      expect(entry.track.albumId).toBe(entry.album.id);
    }
  });

  it('shares provisional IDs with the Spotify export importer', async () => {
    const [first] = await loadFeatured();
    const expected = await provisionalTrackId(rowIdentityKey({ position: 7, uri: null, title: 'Fixture Song 1', artistName: 'Fixture Artist', albumName: 'Fixture Album 1' }));
    expect(first!.track.id).toBe(expected);
  });

  it('keeps only https previews, beside the track rather than inside it', async () => {
    const [secure, insecure] = await loadFeatured();
    expect(previewFor(secure!.track.id)).toBe('https://example.test/preview/1.m4a');
    expect(insecure!.preview).toBeUndefined();
    expect(previewFor(insecure!.track.id)).toBeUndefined();
  });

  it('reloads the device cache and drops records that fail the schema', async () => {
    const entries = await loadFeatured();
    const tampered = [...entries, { ...entries[0]!, track: { ...entries[0]!.track, streamUrl: 'https://example.test/x' } }];
    localStorage.setItem('fy-catalog-v2', JSON.stringify(tampered));
    expect(cachedFeatured().map(entry => entry.track.id)).toEqual(entries.map(entry => entry.track.id));
  });
});
