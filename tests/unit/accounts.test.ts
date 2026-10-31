import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountService, SessionVault, accountFailure, type Encryption } from '@fyspoti/accounts';
import type { Database } from '@fyspoti/library';

const fixtures: { directory: string; vault: SessionVault; service?: AccountService }[] = [];
function encryption(): Encryption {
  const key = randomBytes(32);
  return { available: async () => true,
    encrypt: async text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async bytes => { const data = Buffer.from(bytes); const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(-16)); return { result: Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(), shouldReEncrypt: false }; },
  };
}
async function fixture(crypto: Encryption = encryption()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fyspoti-vault-'));
  const file = path.join(directory, 'session.enc'); const vault = new SessionVault(file, crypto);
  const result: { directory: string; file: string; vault: SessionVault; service?: AccountService } = { directory, file, vault };
  fixtures.push(result); return result;
}
afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    await item.service?.close(); await item.vault.flush();
    for (const file of ['session.enc', 'session.enc.tmp']) await unlink(path.join(item.directory, file)).catch(() => {});
    await rmdir(item.directory);
  }
});

describe('encrypted session vault', () => {
  it('persists only ciphertext and restores the original SDK storage', async () => {
    const crypt = encryption(); const item = await fixture(crypt); await item.vault.initialize();
    await item.vault.storage().setItem('sdk-session', 'private-refresh-token');
    expect((await readFile(item.file)).toString()).not.toContain('private-refresh-token');
    const reopened = new SessionVault(item.file, crypt); await reopened.initialize();
    expect(await reopened.storage().getItem('sdk-session')).toBe('private-refresh-token');
  });
  it('uses memory only when OS encryption is unavailable', async () => {
    const item = await fixture({ ...encryption(), available: async () => false }); await item.vault.initialize();
    const storage = item.vault.storage(); await storage.setItem('sdk-session', 'secret');
    expect(await storage.getItem('sdk-session')).toBe('secret'); expect(item.vault.persistent).toBe(false);
    await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('prevents queued encryption and retired SDK handles from restoring a logged-out session', async () => {
    let complete!: (bytes: Uint8Array) => void;
    const item = await fixture({ ...encryption(), encrypt: () => new Promise(resolve => { complete = resolve; }) }); await item.vault.initialize();
    const storage = item.vault.storage(); const writing = storage.setItem('sdk-session', 'old-account');
    await Promise.resolve(); const clearing = item.vault.clear(); complete(Buffer.from('ciphertext'));
    await Promise.all([writing, clearing]); await storage.setItem('sdk-session', 'late-old-account');
    await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await item.vault.storage().getItem('sdk-session')).toBeNull();
  });
  it('falls back to a temporary session on encrypt failure without writing plaintext', async () => {
    const item = await fixture({ ...encryption(), encrypt: async () => { throw new Error('OS unavailable'); } }); await item.vault.initialize();
    await item.vault.storage().setItem('session', 'secret');
    expect(item.vault.persistent).toBe(false); expect(item.vault.notice).toContain('until the app closes');
    await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'fixture@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-31T00:00:00Z' };
const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`;
const session = { access_token: token, refresh_token: 'private-refresh-token', token_type: 'bearer', expires_in: 3600, user };
async function serviceFixture() {
  const item = await fixture();
  let now = 100000; let verifyStatus = 200; let userStatus = 200; let revokeFails = false;
  let delayed: Promise<Response> | null = null;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.pathname.endsWith('/otp')) return Response.json({});
    if (url.pathname.endsWith('/verify')) return delayed ?? (verifyStatus === 200 ? Response.json(session) : Response.json({ code: 'otp_expired', msg: 'expired' }, { status: verifyStatus }));
    if (url.pathname.endsWith('/user')) return userStatus === 200 ? Response.json(user) : Response.json({ message: 'unavailable' }, { status: userStatus });
    if (url.pathname.endsWith('/logout')) return revokeFails ? Response.json({ message: 'offline' }, { status: 400 }) : new Response(null, { status: 204 });
    if (url.pathname.endsWith('/profile_mutate')) return Response.json({ id: user.id, displayName: 'Listener', revision: 1 });
    return Response.json([]);
  });
  const make = () => new AccountService({ url: 'http://127.0.0.1:54321', publishableKey: 'test-publishable-key', vault: item.vault, now: () => now,
    makeClient: storage => createClient<Database>('http://127.0.0.1:54321', 'test-publishable-key', { auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } }),
  });
  const service = make(); item.service = service; await service.initialize();
  return { ...item, service, fetcher, make, clock: (value: number) => { now = value; }, failCode: () => { verifyStatus = 403; }, failUser: (status: number) => { userStatus = status; }, failRevoke: () => { revokeFails = true; }, delay: (promise: Promise<Response>) => { delayed = promise; } };
}
describe('passwordless account lifecycle', () => {
  it('serializes code requests and rejects a request that races local sign-out', async () => {
    const item = await serviceFixture();
    const first = item.service.requestEmailCode(user.email);
    expect(await item.service.requestEmailCode('other@example.test')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect((await first).ok).toBe(true);
    const signingOut = item.service.signOut();
    expect(await item.service.requestEmailCode('other@example.test')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await signingOut;
    expect(item.service.snapshot().account.phase).toBe('signed-out');
  });
  it('verifies a code, exposes only sanitized state, and restores the encrypted session', async () => {
    const item = await serviceFixture();
    expect((await item.service.requestEmailCode(user.email)).ok).toBe(true);
    expect((await item.service.verifyEmailCode(user.email, '123456')).ok).toBe(true);
    expect(item.service.snapshot()).toMatchObject({ account: { phase: 'authenticated', userId: user.id }, profile: { displayName: 'Listener' } });
    expect(JSON.stringify(item.service.snapshot())).not.toMatch(/private-refresh-token|access_token|refresh_token/);
    await item.service.close(); const reopened = item.make(); fixtures[fixtures.length - 1]!.service = reopened;
    await reopened.initialize(); expect(reopened.snapshot().account.phase).toBe('authenticated');
  });
  it('checks OTP input, cooldowns, email binding and invalid codes', async () => {
    const item = await serviceFixture();
    expect(await item.service.requestEmailCode('bad-email')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    await item.service.requestEmailCode(user.email);
    expect(await item.service.requestEmailCode(user.email)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(await item.service.verifyEmailCode('someone@example.test', '123456')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    item.failCode(); expect(await item.service.verifyEmailCode(user.email, '123456')).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    expect(item.service.snapshot().account.userId).toBeNull(); item.clock(161000);
    expect((await item.service.requestEmailCode(user.email)).ok).toBe(true);
  });
  it('clears credentials and private state even when remote sign-out fails', async () => {
    const item = await serviceFixture(); await item.service.requestEmailCode(user.email); await item.service.verifyEmailCode(user.email, '123456');
    item.failRevoke(); await item.service.signOut();
    expect(item.service.snapshot()).toMatchObject({ account: { phase: 'signed-out', userId: null }, profile: null, library: { accountId: null, playlists: [] } });
    await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
    const revocation = item.fetcher.mock.calls.find(([input]) => String(input).includes('/logout'));
    expect(revocation).toBeDefined();
    expect(new Headers(revocation![1]?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(item.service.snapshot().account.error?.message).toContain('termination could not be confirmed');
  });
  it('discards a late verification response after sign-out', async () => {
    const item = await serviceFixture(); let resolve!: (value: Response) => void;
    item.delay(new Promise(done => { resolve = done; })); await item.service.requestEmailCode(user.email);
    const verifying = item.service.verifyEmailCode(user.email, '123456'); await Promise.resolve();
    await item.service.signOut(); resolve(Response.json(session));
    expect(await verifying).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    expect(item.service.snapshot().account.userId).toBeNull(); await item.vault.flush();
    await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves encrypted credentials on transient restore failures and clears rejected credentials', async () => {
    const item = await serviceFixture(); await item.service.requestEmailCode(user.email); await item.service.verifyEmailCode(user.email, '123456');
    item.failUser(400); expect(await item.service.restore()).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect((await readFile(item.file)).length).toBeGreaterThan(0);
    item.failUser(403); expect(await item.service.restore()).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    await item.vault.flush(); await expect(readFile(item.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('maps rate limits and rejects privileged client keys', async () => {
    expect(accountFailure({ status: 429 })).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    const item = await fixture(); expect(() => new AccountService({ url: 'http://localhost', publishableKey: 'sb_secret_not_for_clients', vault: item.vault })).toThrow('publishable');
  });
});
