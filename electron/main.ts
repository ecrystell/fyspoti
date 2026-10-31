import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { YoutubeSource } from '../p2/src/youtube-source.ts';
import { installCatalog } from './catalog.ts';

if (process.env.FYSPOTI_USER_DATA) app.setPath('userData', path.resolve(process.env.FYSPOTI_USER_DATA));
let accounts: { service: unknown; close(): Promise<void> } | undefined;
let playback: { close(): Promise<void> } | undefined;
let quitting = false;

// Downloads remain in their standalone host. Account mode only starts a source
// subprocess for an explicit play request, using P2's configured Python runtime.
const env = (name: string): string => process.env[name] ?? '';
const appRoot = app.getAppPath();
const sourcePython = env('FYSPOTI_PYTHON') || path.join(appRoot, 'p2', '.venv', 'Scripts', 'python.exe');

app.whenReady().then(async () => {
  const appUrl = pathToFileURL(path.join(appRoot, 'dist/index.html')).href;
  const window = new BrowserWindow({
    width: 1600, height: 940, minWidth: 1000, minHeight: 650, frame: false, backgroundColor: '#000', show: process.env.FYSPOTI_E2E !== '1',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Provider and help links open in the system browser; the app window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.on('window-action', (event, action) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== appUrl) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  // P3's session service stays in the main process alongside P2's services.
  const accountModule = await import(pathToFileURL(path.join(appRoot, 'electron/accounts.mjs')).href);
  accounts = await accountModule.installAccounts({ app, ipcMain, safeStorage, window, appUrl });
  try {
    const catalog = installCatalog({ ipcMain, window, appUrl, python: env('FYSPOTI_CATALOG_PYTHON') || sourcePython, workerPath: path.join(appRoot, 'services', 'catalog-worker', 'worker.py') });
    app.on('will-quit', () => catalog.close());
  } catch (error) { console.error('P4 catalog failed to start', error); }
  const playbackModule = await import(pathToFileURL(path.join(appRoot, 'electron/playback.mjs')).href);
  const sourceScript = process.env.FYSPOTI_E2E === '1' && process.env.FYSPOTI_TEST_SOURCE_SCRIPT ? process.env.FYSPOTI_TEST_SOURCE_SCRIPT : path.join(appRoot, 'p2', 'worker', 'youtube_source.py');
  const source = new YoutubeSource(sourcePython, sourceScript);
  playback = await playbackModule.installPlayback({ app, ipcMain, safeStorage, window, appUrl, accounts: accounts!.service, resolveSource: (track: Parameters<YoutubeSource['resolve']>[0], signal: AbortSignal) => source.resolve(track, signal), prefetchSource: (track: Parameters<YoutubeSource['prefetch']>[0]) => source.prefetch(track) });
  await window.loadFile(path.join(__dirname, '../dist/index.html'));
}).catch(() => { console.error('Desktop initialization failed. Check the local account configuration.'); app.quit(); });
app.on('before-quit', event => {
  if (quitting || !accounts) return;
  event.preventDefault(); quitting = true;
  Promise.resolve(playback?.close()).then(() => accounts!.close()).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
