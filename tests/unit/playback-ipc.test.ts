import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { AccountState, PlaybackSession } from '@fyspoti/contracts';
const modulePath = '../../electron/playback.mjs';
const { installPlayback } = await import(modulePath);

describe('scoped P2 playback IPC', () => {
  it('denies legacy private data and forged payloads, rejects missing duration, and cancels late account resolutions', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<any>>();
    const frame = { url: 'file:///fixture/index.html' };
    const window = { isDestroyed: () => false, webContents: { mainFrame: frame, getURL: () => frame.url, send: vi.fn() } };
    let accountChanged!: (state: { account: Pick<AccountState, 'phase' | 'userId'> }) => void;
    let release!: (source: unknown) => void; let signal!: AbortSignal;
    const resolveSource = vi.fn((_track: unknown, abort: AbortSignal) => { signal = abort; return new Promise(resolve => { release = resolve; }); });
    const installed = await installPlayback({ app: { getPath: () => tmpdir() }, ipcMain: { handle: (name: string, callback: typeof handlers extends Map<string, infer V> ? V : never) => handlers.set(name, callback), removeHandler: (name: string) => handlers.delete(name) },
      safeStorage: { isAsyncEncryptionAvailable: async () => false }, window, appUrl: frame.url,
      accounts: { subscribe: (listener: typeof accountChanged) => { accountChanged = listener; listener({ account: { phase: 'authenticated', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }); return () => {}; } }, resolveSource });
    const trusted = { sender: window.webContents, senderFrame: frame };
    const call = async (name: string, payload?: unknown) => handlers.get(name)!(trusted, payload);
    try {
      const session = (await call('playback:session')).value as PlaybackSession;
      for (const name of ['jobs', 'artifacts', 'load-player', 'save-player', 'resolve-stream', 'select-local', 'download-track', 'artifact-url']) await expect(call('p2:' + name)).rejects.toThrow('unavailable');
      expect(await handlers.get('playback:load')!({ ...trusted, senderFrame: { url: frame.url } }, session.generation)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const track = { id: randomUUID(), trackId: randomUUID(), title: 'Fixture', artist: 'Artist', durationMs: 0 };
      expect(await call('playback:resolve', { generation: session.generation, track, owner: randomUUID() })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
      expect(await call('playback:resolve', { generation: session.generation, track })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }); expect(resolveSource).not.toHaveBeenCalled();
      const pending = call('playback:resolve', { generation: session.generation, track: { ...track, durationMs: 120000 } });
      await Promise.resolve(); accountChanged({ account: { phase: 'signed-out', userId: null } }); expect(signal.aborted).toBe(true);
      release({ uri: 'https://fixture.example/a.wav', local: false, seekable: true });
      expect(await pending).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
      accountChanged({ account: { phase: 'authenticated', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
      expect(await call('playback:load', session.generation)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
      expect(await call('playback:load', { generation: session.generation, file: '../player.json' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    } finally { await installed.close(); }
    expect(handlers.size).toBe(0);
  });
});
