import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPlaybackStore, type Encryption } from '@fyspoti/accounts';
import { PlaybackSnapshotSchema, type PlaybackSnapshot, type ScopedPlaybackBridge } from '@fyspoti/contracts';
import type { AudioEngine, AudioEvent, PlayableSource } from '../../p2/src/contracts.ts';
import { createAccountRendererPlayer } from '../../p2/src/account-renderer-player.ts';
import { bindMediaSession } from '../../p2/src/media-session.ts';
import { Player } from '../../p2/src/player.ts';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });
function encryption(): Encryption {
  const key = randomBytes(32);
  return { available: async () => true,
    encrypt: async text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async value => { const bytes = Buffer.from(value), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16)); return { result: Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(), shouldReEncrypt: false }; },
  };
}
function snapshot(title = 'Private A title'): PlaybackSnapshot {
  const id = randomUUID();
  return { state: { generation: 1, status: 'playing', currentItemId: id, queue: [{ id, trackId: randomUUID(), title, artist: 'Fixture Artist', durationMs: 214000 }], positionMs: 1000, durationMs: 214000, volume: .4, repeat: 'off', shuffle: false }, modes: { [id]: 'preview' }, upcomingIds: [] };
}
async function store(crypto = encryption()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fyspoti-playback-')); directories.push(directory);
  const value = new AccountPlaybackStore(directory, crypto); await value.initialize(); value.setAccount({ phase: 'authenticated', userId: a });
  return { value, directory, crypto };
}
describe('account-scoped encrypted queues', () => {
  it('retains A across logout without exposing its queue to guest/B or accepting retired saves', async () => {
    const { value, directory, crypto } = await store(); const original = snapshot(); const first = value.session().generation;
    expect((await value.save(first, original)).ok).toBe(true);
    expect((await readFile(path.join(directory, a + '.enc'))).toString()).not.toContain('Private A title');
    value.setAccount({ phase: 'signed-out', userId: null });
    expect(await value.load(value.session().generation)).toEqual({ ok: true, value: null });
    expect(await value.save(first, snapshot('Late A'))).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    value.setAccount({ phase: 'authenticated', userId: b });
    expect(await value.load(value.session().generation)).toEqual({ ok: true, value: null });
    await value.save(value.session().generation, snapshot('Private B title')); await value.close();
    const reopened = new AccountPlaybackStore(directory, crypto); await reopened.initialize(); reopened.setAccount({ phase: 'authenticated', userId: a });
    expect(await reopened.load(reopened.session().generation)).toEqual({ ok: true, value: original }); await reopened.close();
  });
  it('finishes only accepted writes for their captured owner during account switching', async () => {
    const crypt = encryption(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const item = await store({ ...crypt, encrypt: async text => { await gate; return crypt.encrypt(text); } });
    const first = item.value.session().generation; const original = snapshot(); const accepted = item.value.save(first, original);
    item.value.setAccount({ phase: 'authenticated', userId: b });
    const second = snapshot('B'); const acceptedB = item.value.save(item.value.session().generation, second); release();
    await Promise.all([accepted, acceptedB]);
    expect(await item.value.save(first, snapshot('Old generation'))).toMatchObject({ ok: false });
    item.value.setAccount({ phase: 'authenticated', userId: a });
    expect((await item.value.load(item.value.session().generation))).toEqual({ ok: true, value: original }); await item.value.close();
  });
  it('rejects forged paths, corrupt owner envelopes, oversized queues and persisted URLs', async () => {
    const item = await store(); const state = snapshot();
    expect(PlaybackSnapshotSchema.safeParse({ ...state, state: { ...state.state, queue: [{ ...state.state.queue[0], trackId: 'file:///private/a.mp3' }] } }).success).toBe(false);
    expect(await item.value.save(item.value.session().generation, { ...state, owner: b })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(PlaybackSnapshotSchema.safeParse({ ...state, state: { ...state.state, queue: Array.from({ length: 10001 }, () => ({ ...state.state.queue[0], id: randomUUID() })) } }).success).toBe(false);
    await writeFile(path.join(item.directory, a + '.enc'), await item.crypto.encrypt(JSON.stringify({ version: 1, owner: b, snapshot: state })));
    expect(await item.value.load(item.value.session().generation)).toEqual({ ok: true, value: null }); expect(item.value.session().notice).toContain('could not be restored'); await item.value.close();
  });
  it('uses memory only when encryption is unavailable and never loads a guest queue', async () => {
    const item = await store({ ...encryption(), available: async () => false }); const saved = snapshot();
    await item.value.save(item.value.session().generation, saved);
    await expect(readFile(path.join(item.directory, a + '.enc'))).rejects.toMatchObject({ code: 'ENOENT' });
    item.value.setAccount({ phase: 'signed-out', userId: null }); await item.value.save(item.value.session().generation, snapshot('Guest'));
    expect(await item.value.load(item.value.session().generation)).toEqual({ ok: true, value: null });
    item.value.setAccount({ phase: 'authenticated', userId: a }); expect(await item.value.load(item.value.session().generation)).toEqual({ ok: true, value: saved }); await item.value.close();
  });
});

class FakeAudio implements AudioEngine {
  source: PlayableSource | null = null; playing = false; generation = 0; listeners = new Set<(event: AudioEvent) => void>();
  async load(source: PlayableSource, generation: number) { this.source = source; this.generation = generation; }
  async play() { this.playing = true; } pause() { this.playing = false; } seek() {} setVolume() {} unload() { this.source = null; this.playing = false; }
  onEvent(listener: (event: AudioEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
const session = { generation: 1, userId: a, available: true, persistent: true, notice: null };
function bridge(saved: PlaybackSnapshot | null = null): ScopedPlaybackBridge {
  return { session: async () => ({ ok: true, value: session }), load: vi.fn<ScopedPlaybackBridge['load']>(async () => ({ ok: true, value: saved })), save: vi.fn<ScopedPlaybackBridge['save']>(async () => ({ ok: true, value: undefined })), resolve: vi.fn<ScopedPlaybackBridge['resolve']>(async () => ({ ok: false, error: { code: 'UNAVAILABLE', message: 'Fixture full-track failure', retryable: true } })), subscribe: () => () => {} };
}
describe('P2 scoped renderer player', () => {
  it('keeps a failed queue for retry when no preview exists and rejects oversized playback', async () => {
    const api = bridge(), engine = new FakeAudio(); const item = snapshot().state.queue[0]!;
    const created = await createAccountRendererPlayer(api, session, () => undefined, () => {}, () => {}, engine, () => () => {});
    await created.player.setQueue([item], item.id);
    expect(created.player.snapshot()).toMatchObject({ status: 'error', queue: [item] }); expect(engine.playing).toBe(false);
    expect(() => created.player.setQueue(Array.from({ length: 10001 }, () => ({ ...item, id: randomUUID() })))).toThrow('10000');
    created.dispose();
  });
  it('does not register media controls when a saved queue arrives after its scope retired', async () => {
    const api = bridge(), engine = new FakeAudio(); let resolve!: (value: Awaited<ReturnType<ScopedPlaybackBridge['load']>>) => void;
    api.load = () => new Promise(done => { resolve = done; }); let active = true; const bind = vi.fn(() => () => {});
    const pending = createAccountRendererPlayer(api, session, () => undefined, () => {}, () => {}, engine, bind, () => active);
    active = false; resolve({ ok: true, value: snapshot() }); await expect(pending).rejects.toThrow('session changed');
    expect(bind).not.toHaveBeenCalled(); expect(engine.source).toBeNull();
  });
  it('automatically falls back to preview, persists mode without its URL, and restores paused', async () => {
    const api = bridge(); const engine = new FakeAudio(); const item = snapshot().state.queue[0]!;
    const created = await createAccountRendererPlayer(api, session, () => 'https://audio-ssl.itunes.apple.com/preview.wav', () => {}, () => {}, engine, () => () => {});
    await created.player.setQueue([item], item.id); await created.flush();
    expect(created.mode()).toBe('preview'); expect(engine.playing).toBe(true);
    const persisted = vi.mocked(api.save).mock.calls.at(-1)![1]; expect(JSON.stringify(persisted)).not.toContain('https:');
    created.dispose(); expect(engine.playing).toBe(false); expect(created.player.snapshot().queue).toEqual([]);
    const restoredApi = bridge(persisted), restoredEngine = new FakeAudio();
    const restored = await createAccountRendererPlayer(restoredApi, session, () => 'https://audio-ssl.itunes.apple.com/new.wav', () => {}, () => {}, restoredEngine, () => () => {});
    expect(restored.player.snapshot().status).toBe('paused'); expect(restoredEngine.source).toBeNull(); expect(restoredApi.resolve).not.toHaveBeenCalled();
    await restored.player.resume(); expect(restoredEngine.source?.uri).toContain('new.wav'); restored.dispose();
  });
  it('keeps duplicate tracks distinct and persists manual upcoming order independently of library edits', async () => {
    const api = bridge(), engine = new FakeAudio(); const first = snapshot().state.queue[0]!, second = { ...first, id: randomUUID() }, third = { ...first, id: randomUUID() };
    const instance = await createAccountRendererPlayer(api, session, () => 'https://audio-ssl.itunes.apple.com/preview.wav', () => {}, () => {}, engine, () => () => {});
    await instance.player.setQueue([first, second, third], first.id); instance.player.reorderQueue([third.id, second.id]); await instance.flush();
    const persisted = vi.mocked(api.save).mock.calls.at(-1)![1]; expect(persisted.upcomingIds).toEqual([third.id, second.id]); instance.dispose();
    const next = await createAccountRendererPlayer(bridge(persisted), session, () => undefined, () => {}, () => {}, new FakeAudio(), () => () => {});
    expect(next.player.upcomingItems().map(item => item.id)).toEqual([third.id, second.id]); expect(next.player.snapshot().queue).toHaveLength(3); next.dispose();
  });
  it('does not play a late source after disposal and does not fall back across account loss', async () => {
    const api = bridge(), engine = new FakeAudio(); let release!: (value: Awaited<ReturnType<ScopedPlaybackBridge['resolve']>>) => void;
    api.resolve = () => new Promise(resolve => { release = resolve; });
    const instance = await createAccountRendererPlayer(api, session, () => 'https://audio-ssl.itunes.apple.com/preview.wav', () => {}, () => {}, engine, () => () => {});
    const item = snapshot().state.queue[0]!; const playing = instance.player.setQueue([item], item.id); instance.dispose();
    release({ ok: true, value: { uri: 'https://fixture.example/full.wav', local: false, seekable: true } }); await playing;
    expect(engine.source).toBeNull(); expect(engine.playing).toBe(false);
    const denied = bridge(); denied.resolve = async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Account changed', retryable: false } });
    const other = await createAccountRendererPlayer(denied, session, () => 'https://audio-ssl.itunes.apple.com/preview.wav', () => {}, () => {}, new FakeAudio(), () => () => {});
    await other.player.setQueue([item], item.id); expect(other.player.snapshot().status).toBe('error'); expect(other.player.snapshot().queue).toHaveLength(1); other.dispose();
  });
  it('unregisters system media handlers and clears private OS metadata', () => {
    const handlers = new Map<string, unknown>(); const media = { metadata: null, playbackState: '', setActionHandler: (name: string, handler: unknown) => handlers.set(name, handler), setPositionState: vi.fn() };
    vi.stubGlobal('navigator', { mediaSession: media }); vi.stubGlobal('MediaMetadata', class { constructor(public value: unknown) {} });
    const player = new Player(new FakeAudio(), { resolve: async () => ({ uri: 'https://fixture.example/a.wav', local: false, seekable: true }) });
    const unbind = bindMediaSession(player); player.restore(snapshot().state); expect(media.metadata).not.toBeNull(); unbind();
    expect(media.metadata).toBeNull(); expect([...handlers.values()].every(value => value === null)).toBe(true); player.stop();
  });
});
