import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Library, Page, Playlist, PlaylistItem } from '@fyspoti/contracts';
import { createLibrary, createMemoryClient, signInWithPassword, type Database } from '@fyspoti/library';
import { fixtureTracks } from '../fixtures/tracks.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.includes('replace_me')) throw new Error(`Set ${name} for the integration target.`);
  return value;
}

const url = required('SUPABASE_URL');
const key = required('SUPABASE_PUBLISHABLE_KEY');
const adminKey = required('SUPABASE_TEST_ADMIN_KEY');
const target = required('SUPABASE_TEST_TARGET');
const endpoint = new URL(url);
if (target === 'local') {
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Local tests require a loopback URL.');
} else if (target === 'hosted') {
  const ref = required('SUPABASE_TEST_PROJECT_REF');
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== `${ref}.supabase.co`) throw new Error('Hosted development project ref does not match URL.');
} else {
  throw new Error('SUPABASE_TEST_TARGET must be local or hosted.');
}

// This client is restricted to fixture provisioning and cleanup below.
const admin = createClient<Database>(url, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const createdUsers: string[] = [];
const sessions: SupabaseClient<Database>[] = [];
const runId = randomUUID();
const password = `Fys-${randomUUID()}-test!`;
const emailA = `fyspoti-a-${runId}@example.test`;
const emailB = `fyspoti-b-${runId}@example.test`;
let a: SupabaseClient<Database>;
let b: SupabaseClient<Database>;
let anon: SupabaseClient<Database>;
let libraryA: Library;
let libraryB: Library;
let saved: Playlist;
let items: PlaylistItem[];
const track = fixtureTracks[0]!;

function memoryClient(): SupabaseClient<Database> {
  const client = createMemoryClient(url, key);
  sessions.push(client);
  return client;
}

async function allPages<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await read(cursor);
    result.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('Pagination cursor repeated.');
      seen.add(cursor);
    }
  } while (cursor);
  return result;
}

describe(`P3 persistence and account isolation (${target})`, () => {
  beforeAll(async () => {
    for (const email of [emailA, emailB]) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not provision synthetic Auth fixture: ${error?.code ?? 'no user'}`);
      createdUsers.push(data.user.id);
    }
    a = memoryClient();
    b = memoryClient();
    anon = memoryClient();
    await signInWithPassword(a, emailA, password);
    await signInWithPassword(b, emailB, password);
    libraryA = createLibrary(a, { pageSize: 2 });
    libraryB = createLibrary(b, { pageSize: 2 });
    saved = await libraryA.createPlaylist('M0 cloud persistence');
    items = [];
    // Same recording twice, with a different item ID and manual position each time.
    for (const orderingKey of [20, 0, 10]) {
      items.push(await libraryA.addPlaylistItem(saved.id, { trackId: track.id, orderingKey, metadataSnapshot: track.metadataSnapshot }));
    }
  });

  afterAll(async () => {
    for (const client of sessions) {
      client.auth.stopAutoRefresh();
    }
    // Delete only users created by this run; FK cascades remove their fixture playlists.
    const failures: string[] = [];
    for (const id of createdUsers) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) failures.push(id);
    }
    if (failures.length) throw new Error(`Fixture cleanup failed for synthetic user IDs: ${failures.join(', ')}`);
  });

  it('reloads the playlist, snapshots and duplicate items in an independent session', async () => {
    const fresh = memoryClient();
    expect((await fresh.auth.getSession()).data.session).toBeNull();
    await signInWithPassword(fresh, emailA, password);
    const reader = createLibrary(fresh, { pageSize: 2 });
    expect(await reader.getPlaylist(saved.id)).toEqual(saved);
    const restored = await allPages(cursor => reader.listPlaylistItems(saved.id, cursor));
    expect(restored.map(item => item.orderingKey)).toEqual([0, 10, 20]);
    expect(new Set(restored.map(item => item.id)).size).toBe(3);
    expect(restored.every(item => item.trackId === track.id)).toBe(true);
    expect(restored.every(item => JSON.stringify(item.metadataSnapshot) === JSON.stringify(track.metadataSnapshot))).toBe(true);
    expect(restored.map(item => item.id).sort()).toEqual(items.map(item => item.id).sort());
  });

  it('paginates playlists and items without missing or repeated rows', async () => {
    for (let index = 0; index < 4; index++) await libraryA.createPlaylist(`Pagination ${index}`);
    const lists = await allPages(cursor => libraryA.listPlaylists(cursor));
    expect(lists).toHaveLength(5);
    expect(new Set(lists.map(list => list.id)).size).toBe(5);
    expect(lists.map(list => list.id)).toEqual(lists.map(list => list.id).sort());
    const restored = await allPages(cursor => libraryA.listPlaylistItems(saved.id, cursor));
    expect(restored).toHaveLength(3);
    expect(await libraryB.listPlaylists()).toEqual({ items: [], nextCursor: null });
  });

  it('hides known private IDs through the library API', async () => {
    await expect(libraryB.getPlaylist(saved.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(libraryB.listPlaylistItems(saved.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(libraryB.addPlaylistItem(saved.id, { trackId: track.id, orderingKey: 30, metadataSnapshot: track.metadataSnapshot })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('blocks account B and unauthenticated reads even when bypassing the wrapper', async () => {
    for (const attacker of [b, anon]) {
      const list = await attacker.from('playlists').select('*').eq('id', saved.id);
      expect(list.data ?? []).toEqual([]);
      const entries = await attacker.from('playlist_items').select('*').eq('id', items[0]!.id);
      expect(entries.data ?? []).toEqual([]);
    }
  });

  it('rejects forged owners, cross-account item insertion, and anonymous writes', async () => {
    const ownerA = createdUsers[0]!;
    const ownerB = createdUsers[1]!;
    for (const [attacker, forgedOwner] of [[b, ownerA], [a, ownerB], [anon, ownerA]] as const) {
      const result = await attacker.from('playlists').insert({ owner_id: forgedOwner, title: 'Forged owner' });
      expect(result.error).not.toBeNull();
    }
    for (const attacker of [b, anon]) {
      const result = await attacker.from('playlist_items').insert({
        playlist_id: saved.id, track_id: track.id, ordering_key: 99,
        snapshot_title: track.metadataSnapshot.title,
        snapshot_artist_names: track.metadataSnapshot.artistNames,
        snapshot_duration_ms: track.metadataSnapshot.durationMs,
      });
      expect(result.error).not.toBeNull();
    }
    expect(await allPages(cursor => libraryA.listPlaylistItems(saved.id, cursor))).toHaveLength(3);
  });

  it('rejects direct update/delete attempts without altering the owner’s data', async () => {
    for (const attacker of [b, anon, a]) {
      expect((await attacker.from('playlists').update({ title: 'Hijacked', owner_id: createdUsers[1]! }).eq('id', saved.id)).error).not.toBeNull();
      expect((await attacker.from('playlists').delete().eq('id', saved.id)).error).not.toBeNull();
      expect((await attacker.from('playlist_items').update({ track_id: fixtureTracks[1]!.id }).eq('id', items[0]!.id)).error).not.toBeNull();
      expect((await attacker.from('playlist_items').delete().eq('id', items[0]!.id)).error).not.toBeNull();
    }
    expect(await libraryA.getPlaylist(saved.id)).toEqual(saved);
    expect(await allPages(cursor => libraryA.listPlaylistItems(saved.id, cursor))).toHaveLength(3);
  });

  it('enforces order uniqueness while allowing the same track at different positions', async () => {
    await expect(libraryA.addPlaylistItem(saved.id, { trackId: track.id, orderingKey: 0, metadataSnapshot: track.metadataSnapshot })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not reuse account A’s cursor or session when switching accounts', async () => {
    const cursor = (await libraryA.listPlaylists()).nextCursor!;
    await expect(libraryB.listPlaylists(cursor)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const switcher = memoryClient();
    await signInWithPassword(switcher, emailA, password);
    const library = createLibrary(switcher);
    expect((await library.listPlaylists()).items.length).toBeGreaterThan(0);
    const { error } = await switcher.auth.signOut({ scope: 'local' });
    expect(error).toBeNull();
    await expect(library.listPlaylists()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await signInWithPassword(switcher, emailB, password);
    expect(await library.listPlaylists()).toEqual({ items: [], nextCursor: null });
  });

  it('rejects an expired/tampered bearer token at the direct database API', async () => {
    const expired = memoryClient();
    await signInWithPassword(expired, emailA, password);
    const session = (await expired.auth.getSession()).data.session!;
    const pieces = session.access_token.split('.');
    const payload = JSON.parse(atob(pieces[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    // An expired, invalidly signed token must never reach the database as an owner.
    payload.exp = 1;
    pieces[1] = btoa(JSON.stringify(payload)).replace(/=+$/, '');
    const direct = await fetch(`${url}/rest/v1/playlists?select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${pieces.join('.')}` },
    });
    expect(direct.status).toBe(401);
  });
});
