import { app, dialog, ipcMain, net, protocol, type BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { DownloadJob, DownloadRequest, PlayerState, PlayableSource } from './contracts.ts';
import { DownloadManager, type WorkerPaths } from './download-manager.ts';
import { DownloadStore } from './download-store.ts';
import { LocalFiles } from './local-files.ts';
import { PlayerPersistence } from './player-persistence.ts';
import { YoutubeSource, type TrackRequest } from './youtube-source.ts';

// Call once before app.whenReady().
export function registerP2MediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'p2-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
}

export interface P2Desktop {
  manager: DownloadManager;
  localFiles: LocalFiles;
  enqueueAuthorized(request: DownloadRequest): Promise<DownloadJob>;
}

// Call after app.whenReady(). The host owns the window and its CSP.
export async function installP2Desktop(window: BrowserWindow, worker: WorkerPaths, youtubeScript?: string): Promise<P2Desktop> {
  const manager = new DownloadManager(new DownloadStore(path.join(app.getPath('userData'), 'p2')), worker);
  const youtube = youtubeScript ? new YoutubeSource(worker.python, youtubeScript) : null;
  const localFiles = new LocalFiles(path.join(app.getPath('userData'), 'p2', 'local-files.json'));
  const playerPersistence = new PlayerPersistence(path.join(app.getPath('userData'), 'p2', 'player.json'));
  await manager.open();
  await localFiles.open();
  manager.subscribe(job => { if (!window.isDestroyed()) window.webContents.send('p2:job', job); });

  protocol.handle('p2-media', async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    try {
      const url = new URL(request.url);
      const id = url.pathname.slice(1);
      if (!/^[0-9a-f-]{36}$/i.test(id) || url.search || url.hash) return new Response(null, { status: 404 });
      const file = url.hostname === 'artifact' ? await manager.artifactPath(id) : url.hostname === 'local' ? localFiles.pathFor(id) : undefined;
      if (!file) return new Response(null, { status: 404 });
      return net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
    } catch { return new Response(null, { status: 404 }); }
  });

  const fromWindow = (event: Electron.IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid sender');
  };
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid ID');
    return value;
  };
  ipcMain.handle('p2:jobs', event => { fromWindow(event); return manager.jobs(); });
  ipcMain.handle('p2:artifacts', event => { fromWindow(event); return manager.artifacts(); });
  ipcMain.handle('p2:cancel', (event, value) => { fromWindow(event); return manager.cancel(id(value)); });
  ipcMain.handle('p2:retry', (event, value) => { fromWindow(event); return manager.retry(id(value)); });
  ipcMain.handle('p2:remove-artifact', (event, value) => { fromWindow(event); return manager.removeArtifact(id(value)); });
  ipcMain.handle('p2:artifact-url', async (event, value) => { fromWindow(event); await manager.artifactPath(id(value)); return `p2-media://artifact/${value}`; });
  ipcMain.handle('p2:select-local', async event => {
    fromWindow(event);
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav'] }] });
    return result.canceled ? [] : Promise.all(result.filePaths.map(file => localFiles.add(file)));
  });
  ipcMain.handle('p2:load-player', async event => {
    fromWindow(event);
    return playerPersistence.load();
  });
  ipcMain.handle('p2:save-player', async (event, state: PlayerState) => {
    fromWindow(event);
    if (!state || !Array.isArray(state.queue) || state.queue.length > 10000) throw new Error('Invalid player state');
    await playerPersistence.save(state);
  });
  ipcMain.handle('p2:resolve-stream', async (event, track: TrackRequest): Promise<PlayableSource> => {
    fromWindow(event);
    if (!youtube) throw new Error('Full-track source is not configured');
    return youtube.resolve(track);
  });
  ipcMain.handle('p2:download-track', async (event, track: TrackRequest): Promise<DownloadJob> => {
    fromWindow(event);
    if (!youtube) throw new Error('Download source is not configured');
    const candidate = await youtube.candidate(track);
    return manager.enqueue({ trackId: track.trackId, candidateId: candidate.id, sourceKind: 'yt-dlp', url: candidate.url, title: track.title });
  });
  window.on('closed', () => {
    for (const channel of ['p2:jobs', 'p2:artifacts', 'p2:cancel', 'p2:retry', 'p2:remove-artifact', 'p2:artifact-url', 'p2:select-local', 'p2:load-player', 'p2:save-player', 'p2:resolve-stream', 'p2:download-track']) ipcMain.removeHandler(channel);
    protocol.unhandle('p2-media');
  });
  app.on('before-quit', () => manager.shutdown());
  return { manager, localFiles, enqueueAuthorized: request => manager.enqueue(request) };
}
