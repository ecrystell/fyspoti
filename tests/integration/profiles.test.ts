import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLibraryApi } from '@fyspoti/library';
import { testAccounts, type AccountFixture } from './support.js';

describe('private desktop profiles', () => {
  const accounts = testAccounts(); let a: AccountFixture; let b: AccountFixture;
  beforeAll(async () => { a = await accounts.provision('a'); b = await accounts.provision('b'); });
  afterAll(() => accounts.cleanup());
  it('ensures a default profile, edits with revision checks, and replays exactly once', async () => {
    const ensured = await a.client.rpc('profile_mutate', { mutation_id: randomUUID(), expected_account: a.id, expected_revision: 0, display_name: 'Listener' });
    expect(ensured.error).toBeNull(); expect(ensured.data).toEqual({ id: a.id, displayName: 'Listener', revision: 1 });
    const mutation = { mutation_id: randomUUID(), expected_account: a.id, expected_revision: 1, display_name: 'New name' };
    const updated = await a.client.rpc('profile_mutate', mutation);
    expect(updated.error).toBeNull(); expect(updated.data).toEqual({ id: a.id, displayName: 'New name', revision: 2 });
    expect((await a.client.rpc('profile_mutate', mutation)).data).toEqual(updated.data);
    expect((await a.client.rpc('profile_mutate', { ...mutation, mutation_id: randomUUID(), display_name: 'Stale' })).error?.code).toBe('PT409');
    expect((await a.client.rpc('profile_mutate', { ...mutation, display_name: 'Different replay' })).error?.code).toBe('PT409');
    expect((await a.client.rpc('profile_mutate', { mutation_id: randomUUID(), expected_account: a.id, expected_revision: 0, display_name: 'Listener' })).data).toEqual(updated.data);
  });
  it('rejects other accounts and direct table writes', async () => {
    expect((await b.client.from('profiles').select('*').eq('id', a.id)).data).toEqual([]);
    expect((await b.client.rpc('profile_mutate', { mutation_id: randomUUID(), expected_account: a.id, expected_revision: 2, display_name: 'Hijacked' })).error?.code).toBe('PT401');
    expect((await a.client.from('profiles').update({ display_name: 'Bypass', revision: 99 }).eq('id', a.id)).error).not.toBeNull();
    expect((await a.client.from('profiles').insert({ id: b.id })).error).not.toBeNull();
  });
  it('likes and unlikes a saved snapshot with unknown duration and no catalog lookup', async () => {
    const api = createLibraryApi(a.client, { accountId: a.id });
    const snapshot = { title: 'Saved recording', artistNames: ['Fixture Artist'], durationMs: 0 };
    const saved = await api.setTrackLikeFromSnapshot('provisional-saved-fixture', snapshot, true, randomUUID());
    expect(saved).toMatchObject({ ok: true, value: { liked: true, metadataSnapshot: snapshot } });
    expect(await api.setTrackLikeFromSnapshot('provisional-saved-fixture', snapshot, false, randomUUID())).toMatchObject({ ok: true, value: { liked: false } });
  });
});
