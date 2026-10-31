import { describe, expect, it } from 'vitest';
import { fromItunes, metadata } from '../../src/cloud/catalog.js';

describe('desktop provider identity', () => {
  it('keeps canonical IDs stable when display metadata or preview URLs change', async () => {
    const original = { trackId: 1001, artistId: 2001, trackName: 'Recording', artistName: 'Artist', trackTimeMillis: 214000,
      previewUrl: 'https://audio-ssl.itunes.apple.com/first.m4a' };
    const first = await fromItunes(original);
    const changed = await fromItunes({ ...original, trackName: 'New title', previewUrl: 'https://audio-ssl.itunes.apple.com/second.m4a' });
    expect(first).not.toBeNull(); expect(first!.track.id).toBe(changed!.track.id);
    expect(first!.track.providerRefs).toEqual([{ provider: 'itunes', id: '1001' }]);
    expect(JSON.stringify(metadata(first!.track))).not.toContain('https:');
    expect(JSON.stringify(first!.track)).not.toContain('.m4a');
    expect((await fromItunes({ ...original, trackId: 1002 }))!.track.id).not.toBe(first!.track.id);
  });
  it('rejects missing provider identity and untrusted media URLs', async () => {
    expect(await fromItunes({ trackName: 'Unidentified' })).toBeNull();
    const record = await fromItunes({ trackId: 1, artistId: 2, trackName: 'Recording', artistName: 'Artist', trackTimeMillis: 1000, previewUrl: 'file:///private/local.mp3', artworkUrl100: 'https://evil.example/cover.jpg' });
    expect(record?.preview).toBeUndefined(); expect(record?.track.artwork).toEqual([]);
  });
});
