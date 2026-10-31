import { describe, expect, it } from 'vitest';
import type { BrowserWindow, IpcMain } from 'electron';
import { installCatalog } from '../../electron/catalog.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const APP_URL = 'file:///app/dist/index.html';
const TRACK = '0f8d7c6b-5a49-4382-9716-0a1b2c3d4e5f';

function host(fetcher?: typeof fetch) {
  const handlers = new Map<string, Handler>();
  const mainFrame = { url: APP_URL };
  const webContents = { mainFrame };
  const window = { webContents, on: () => window } as unknown as BrowserWindow;
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); }, removeHandler: (channel: string) => { handlers.delete(channel); } } as unknown as IpcMain;
  // A missing interpreter: every worker call fails the way an unpackaged install would.
  const catalog = installCatalog({ ipcMain, window, appUrl: APP_URL, python: 'C:/missing/python.exe', workerPath: 'C:/missing/worker.py', ...(fetcher ? { fetcher } : {}) });
  const fromApp = { sender: webContents, senderFrame: mainFrame };
  const call = (channel: string, event: unknown, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args));
  return { handlers, call, fromApp, close: catalog.close };
}

describe('desktop catalog IPC', () => {
  it('registers only the catalog read channels', () => {
    const { handlers, close } = host();
    expect([...handlers.keys()].sort()).toEqual(['catalog:find-candidates', 'catalog:get-album', 'catalog:get-artist', 'catalog:get-track', 'catalog:search', 'catalog:top-albums']);
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

 describe('popular album charts',()=>{
  it('uses the chosen country and validates artwork before exposing chart rows',async()=>{let url='';const fetcher=(async(input:unknown)=>{url=String(input);return new Response(JSON.stringify({feed:{updated:'2026-10-31',results:[null,{name:'Fixture Album',artistName:'Fixture Artist',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/test/100x100bb.jpg',url:'https://music.apple.com/us/album/test/1'},{name:'Bad',artistName:'Artist',artworkUrl100:'https://evil.example/cover.jpg'}]}}))}) as typeof fetch;const h=host(fetcher);try{const r=await h.call('catalog:top-albums',h.fromApp,'us',12) as any;expect(url).toContain('/us/music/most-played/12/albums.json');expect(r.ok).toBe(true);expect(r.value.albums).toHaveLength(1);expect(r.value.albums[0].art).toContain('600x600bb.jpg')}finally{h.close()}});
  it('rejects foreign frames, malformed countries and invalid limits before fetching',async()=>{let calls=0;const h=host((async()=>{calls++;return new Response('{}')}) as typeof fetch);try{await expect(h.call('catalog:top-albums',{sender:{}},'us',12)).rejects.toThrow();await expect(h.call('catalog:top-albums',h.fromApp,'../us',12)).rejects.toThrow();await expect(h.call('catalog:top-albums',h.fromApp,'us',51)).rejects.toThrow();expect(calls).toBe(0)}finally{h.close()}});
  it('reports an empty or failed chart as unavailable rather than successful empty data',async()=>{for(const response of [new Response(JSON.stringify({feed:{results:[]}})),new Response('',{status:502})]){const h=host((async()=>response) as typeof fetch);try{const r=await h.call('catalog:top-albums',h.fromApp,'sg',12) as any;expect(r.ok).toBe(false);expect(r.error.code).toBe('UNAVAILABLE')}finally{h.close()}}});
 });
