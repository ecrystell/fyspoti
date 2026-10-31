import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { createCatalog } from '@fyspoti/catalog';
import { createYtMusicWorker } from '@fyspoti/catalog/youtube-worker';
import { TrackHint } from '@fyspoti/contracts';

// Hosts P4's catalog in the main process and exposes it to the renderer over
// validated IPC. Results cross the boundary as Result values, never as throws.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ['catalog:search', 'catalog:get-track', 'catalog:get-album', 'catalog:get-artist', 'catalog:find-candidates'];

export interface CatalogHostOptions { ipcMain: IpcMain; window: BrowserWindow; appUrl: string; python: string; workerPath: string }

export function installCatalog({ ipcMain, window, appUrl, python, workerPath }: CatalogHostOptions): { close(): void } {
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
  window.on('closed', () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); });
  return { close: () => worker.close() };
}
