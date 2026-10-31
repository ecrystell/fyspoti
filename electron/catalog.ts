import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { createCatalog } from '@fyspoti/catalog';
import { createYtMusicWorker } from '@fyspoti/catalog/youtube-worker';
import { TrackHint } from '@fyspoti/contracts';

// Hosts P4's catalog in the main process and exposes it to the renderer over
// validated IPC. Results cross the boundary as Result values, never as throws.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ['catalog:search', 'catalog:get-track', 'catalog:get-album', 'catalog:get-artist', 'catalog:find-candidates', 'catalog:top-albums'];

export interface CatalogHostOptions { ipcMain: IpcMain; window: BrowserWindow; appUrl: string; python: string; workerPath: string; fetcher?: typeof fetch }

export interface TopAlbum { name: string; artistName: string; art: string; releaseDate?: string; url?: string }
export type TopAlbumsResult = { ok: true; value: { updated: string; country: string; albums: TopAlbum[] } } | { ok: false; error: { code: 'UNAVAILABLE'; message: string; retryable: true } };

// Apple's public chart feed ranks albums by plays per country. It sends no CORS header,
// so the main process fetches it. Every field is validated; artwork must be Apple-hosted https.
const ART = /^https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^\s"'<>]+\/100x100bb\.(?:jpg|png|webp)$/;
const text = (value: unknown, max = 300): string | undefined => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined);
async function topAlbums(fetcher: typeof fetch, country: string, limit: number): Promise<TopAlbumsResult> {
  const unavailable = (message: string): TopAlbumsResult => ({ ok: false, error: { code: 'UNAVAILABLE', message, retryable: true } });
  try {
    const response = await fetcher(`https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${limit}/albums.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return unavailable(`Chart feed returned ${response.status}`);
    const feed = ((await response.json()) as { feed?: { updated?: unknown; results?: unknown[] } }).feed;
    const albums = (Array.isArray(feed?.results) ? feed.results : []).flatMap((row): TopAlbum[] => {
      if (!row || typeof row !== 'object') return [];
      const r = row as Record<string, unknown>; const name = text(r.name), artistName = text(r.artistName), art = text(r.artworkUrl100, 1000);
      if (!name || !artistName || !art || !ART.test(art)) return [];
      const releaseDate = text(r.releaseDate, 10), url = text(r.url, 1000);
      return [{ name, artistName, art: art.replace(/100x100bb\./, '600x600bb.'), ...(releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? { releaseDate } : {}), ...(url?.startsWith('https://music.apple.com/') ? { url } : {}) }];
    });
    if (!albums.length) return unavailable('Chart feed had no usable albums');
    return { ok: true, value: { updated: text(feed?.updated, 80) ?? '', country, albums } };
  } catch { return unavailable('Chart feed is unavailable'); }
}

export function installCatalog({ ipcMain, window, appUrl, python, workerPath, fetcher = fetch }: CatalogHostOptions): { close(): void } {
  const worker = createYtMusicWorker({ python, workerPath });
  const catalog = createCatalog({ ytMusic: worker });
  const fromApp = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== appUrl) throw new Error('Invalid sender');
  };
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid catalog ID');
    return value;
  };
  ipcMain.handle('catalog:search', (event, query: unknown, cursor: unknown) => {
    fromApp(event);
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Invalid search query');
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 1024)) throw new Error('Invalid cursor');
    return catalog.search(query.trim(), cursor);
  });
  ipcMain.handle('catalog:get-track', (event, value: unknown) => { fromApp(event); return catalog.getTrack(id(value)); });
  ipcMain.handle('catalog:get-album', (event, value: unknown) => { fromApp(event); return catalog.getAlbum(id(value)); });
  ipcMain.handle('catalog:get-artist', (event, value: unknown) => { fromApp(event); return catalog.getArtist(id(value)); });
  ipcMain.handle('catalog:find-candidates', (event, value: unknown, hint: unknown) => {
    fromApp(event);
    return catalog.findCandidates(id(value), hint === undefined ? {} : { hint: TrackHint.parse(hint) });
  });
  ipcMain.handle('catalog:top-albums', (event, country: unknown, limit: unknown) => {
    fromApp(event);
    if (typeof country !== 'string' || !/^[a-z]{2}$/.test(country)) throw new Error('Invalid country');
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) throw new Error('Invalid limit');
    return topAlbums(fetcher, country, limit as number);
  });
  window.on('closed', () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); });
  return { close: () => worker.close() };
}
