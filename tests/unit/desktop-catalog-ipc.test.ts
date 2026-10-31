import { describe, expect, it } from 'vitest';
import type { BrowserWindow, IpcMain } from 'electron';
import { installCatalog } from '../../electron/catalog.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const APP_URL = 'file:///app/dist/index.html';
const TRACK = '0f8d7c6b-5a49-4382-9716-0a1b2c3d4e5f';

function host() {
  const handlers = new Map<string, Handler>();
  const mainFrame = { url: APP_URL };
  const webContents = { mainFrame };
  const window = { webContents, on: () => window } as unknown as BrowserWindow;
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); }, removeHandler: (channel: string) => { handlers.delete(channel); } } as unknown as IpcMain;
  // A missing interpreter: every worker call fails the way an unpackaged install would.
  const catalog = installCatalog({ ipcMain, window, appUrl: APP_URL, python: 'C:/missing/python.exe', workerPath: 'C:/missing/worker.py' });
  const fromApp = { sender: webContents, senderFrame: mainFrame };
  const call = (channel: string, event: unknown, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args));
  return { handlers, call, fromApp, close: catalog.close };
}

describe('desktop catalog IPC', () => {
  it('registers only the catalog read channels', () => {
    const { handlers, close } = host();
    expect([...handlers.keys()].sort()).toEqual(['catalog:find-candidates', 'catalog:get-album', 'catalog:get-artist', 'catalog:get-track', 'catalog:search']);
    close();
  });

  it('rejects calls from other frames or documents', async () => {
    const { call, fromApp, close } = host();
    await expect(call('catalog:search', { ...fromApp, senderFrame: { url: 'https://evil.example/' } }, 'song', null)).rejects.toThrow('Invalid sender');
    await expect(call('catalog:get-track', { sender: {}, senderFrame: fromApp.senderFrame }, TRACK)).rejects.toThrow('Invalid sender');
    close();
  });

  it('validates IDs, queries, cursors and hints before reaching the worker', async () => {
    const { call, fromApp, close } = host();
    await expect(call('catalog:get-album', fromApp, 'not-a-uuid')).rejects.toThrow('Invalid catalog ID');
    await expect(call('catalog:search', fromApp, '   ', null)).rejects.toThrow('Invalid search query');
    await expect(call('catalog:search', fromApp, 'x'.repeat(201), null)).rejects.toThrow('Invalid search query');
    await expect(call('catalog:search', fromApp, 'song', 42)).rejects.toThrow('Invalid cursor');
    await expect(call('catalog:find-candidates', fromApp, TRACK, { title: 'Song', streamUrl: 'https://x' })).rejects.toThrow();
    close();
  });

  it('reports a missing worker as an UNAVAILABLE result, not an empty page', async () => {
    const { call, fromApp, close } = host();
    const result = await call('catalog:search', fromApp, 'song', null) as { ok: boolean; error?: { code: string; retryable: boolean } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNAVAILABLE');
    close();
  });
});
