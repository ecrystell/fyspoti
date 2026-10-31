import { describe, expect, it, vi } from 'vitest';
import { LibraryError } from '@fyspoti/contracts';
import { createLibrary, createMemoryClient, signInWithPassword } from '@fyspoti/library';
import { fixtureTracks } from '../fixtures/tracks.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-31T00:00:00Z' };
const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`;
const row = { id, owner_id: owner, title: 'Example', visibility: 'private', created_at: '2026-10-31T00:00:00Z' };

function fakeClient(rest: (url: URL, init?: RequestInit) => Response | Promise<Response> = () => Response.json([])) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.pathname.endsWith('/token')) {
      return Response.json({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user });
    }
    if (url.pathname.endsWith('/user')) return Response.json(user);
    return rest(url, init);
  });
  return { client: createMemoryClient('http://127.0.0.1:54321', 'synthetic-public-key', fetcher), fetcher };
}

describe('playlist library', () => {
  it('requires authentication without making a database request', async () => {
    const { client, fetcher } = fakeClient();
    await expect(createLibrary(client).listPlaylists()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('starts each client with an independent in-memory session', async () => {
    const first = fakeClient().client;
    await signInWithPassword(first, user.email, 'password');
    expect((await first.auth.getSession()).data.session?.user.id).toBe(owner);
    expect((await fakeClient().client.auth.getSession()).data.session).toBeNull();
  });

  it('derives ownership from Auth and maps database fields into shared contracts', async () => {
    const { client } = fakeClient((_url, init) => {
      expect(JSON.parse(init!.body as string)).toEqual({ title: 'Example', owner_id: owner });
      return Response.json(row);
    });
    await signInWithPassword(client, user.email, 'password');
    expect(await createLibrary(client).createPlaylist('  Example  ')).toEqual({
      id, ownerId: owner, title: 'Example', visibility: 'private', createdAt: row.created_at,
    });
  });

  it('does not distinguish hidden playlists from missing playlists', async () => {
    const { client } = fakeClient(() => Response.json(null));
    await signInWithPassword(client, user.email, 'password');
    await expect(createLibrary(client).getPlaylist(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    [409, '23505', 'CONFLICT', false],
    [403, '42501', 'FORBIDDEN', false],
    [401, 'PGRST301', 'AUTH_REQUIRED', false],
    [429, '', 'RATE_LIMITED', true],
    [503, '', 'UNAVAILABLE', true],
    [400, '23514', 'INVALID_ARGUMENT', false],
  ])('maps database status %i/%s to %s without leaking details', async (status, code, expected, retryable) => {
    const { client } = fakeClient(() => Response.json({ code, message: 'sensitive SQL detail' }, { status }));
    await signInWithPassword(client, user.email, 'password');
    await expect(createLibrary(client).listPlaylists()).rejects.toMatchObject({ code: expected, retryable });
    await expect(createLibrary(client).listPlaylists()).rejects.not.toHaveProperty('message', 'sensitive SQL detail');
  });

  it('maps a dropped database connection to retryable UNAVAILABLE', async () => {
    const { client } = fakeClient(() => { throw new TypeError('fetch failed'); });
    await signInWithPassword(client, user.email, 'password');
    await expect(createLibrary(client).listPlaylists()).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('rejects invalid titles, IDs, order keys, snapshots, and page sizes', async () => {
    const library = createLibrary(fakeClient().client);
    await expect(library.createPlaylist(' ')).rejects.toBeInstanceOf(LibraryError);
    await expect(library.createPlaylist('a'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(library.getPlaylist('https://provider/track')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const track = fixtureTracks[0]!;
    for (const orderingKey of [-1, 0.5, 2147483648, NaN]) {
      await expect(library.addPlaylistItem(id, { trackId: track.id, orderingKey, metadataSnapshot: track.metadataSnapshot })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(library.addPlaylistItem(id, { trackId: track.id, orderingKey: 0, metadataSnapshot: { title: 'test', artistNames: [], durationMs: 1 } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(() => createLibrary(fakeClient().client, { pageSize: 0 })).toThrow(LibraryError);
  });

  it('uses keyset pagination and rejects malformed or cross-scope cursors before querying', async () => {
    const ids = [id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
    const { client, fetcher } = fakeClient(url => {
      expect(url.searchParams.get('order')).toBe('id.asc');
      expect(url.searchParams.get('limit')).toBe('3');
      const after = url.searchParams.get('id');
      return Response.json(ids.filter(value => !after || value > after.slice(3)).map(value => ({ ...row, id: value })));
    });
    await signInWithPassword(client, user.email, 'password');
    const library = createLibrary(client, { pageSize: 2 });
    const first = await library.listPlaylists();
    expect(first.items.map(value => value.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toBeTypeOf('string');
    const second = await library.listPlaylists(first.nextCursor!);
    expect(second.items.map(value => value.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
    const count = fetcher.mock.calls.filter(([url]) => String(url).includes('/rest/v1')).length;
    await expect(library.listPlaylists('not-json')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(library.listPlaylistItems(id, first.nextCursor!)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/rest/v1'))).toHaveLength(count);
  });

  it('rejects privileged API keys at the client boundary', () => {
    expect(() => createMemoryClient('https://example.supabase.co', 'sb_secret_example')).toThrow(LibraryError);
    const key = `${btoa('{}')}.${btoa(JSON.stringify({ role: 'service_role' }))}.test`;
    expect(() => createMemoryClient('https://example.supabase.co', key)).toThrow(LibraryError);
  });
});
