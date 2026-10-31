import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installP2Desktop, registerP2MediaScheme } from '../p2/src/electron-main.ts';
import type { WorkerPaths } from '../p2/src/download-manager.ts';

registerP2MediaScheme();
if (process.env.FYSPOTI_USER_DATA) app.setPath('userData', path.resolve(process.env.FYSPOTI_USER_DATA));
let accounts: { close(): Promise<void> } | undefined;
let quitting = false;

// P2 never falls back to globally installed tools. Until a release bundles Python,
// FFprobe and FFmpeg, download jobs fail unless these paths are provided.
const env = (name: string): string => process.env[name] ?? '';
const appRoot = app.getAppPath();
const worker: WorkerPaths = {
  python: env('FYSPOTI_PYTHON') || path.join(appRoot, 'p2', '.venv', 'Scripts', 'python.exe'),
  script: path.join(appRoot, 'p2', 'worker', 'worker.py'),
  ffprobe: env('FYSPOTI_FFPROBE') || 'ffprobe',
  ...(env('FYSPOTI_FFMPEG') ? { ffmpeg: env('FYSPOTI_FFMPEG') } : {}),
  ...(env('FYSPOTI_SPOTDL') ? { spotdl: env('FYSPOTI_SPOTDL') } : {}),
};

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
  // The renderer falls back to its own player if these handlers are missing.
  try { await installP2Desktop(window, worker, path.join(appRoot, 'p2', 'worker', 'youtube_source.py')); } catch (error) { console.error('P2 desktop services failed to start', error); }
  // P3's session service stays in the main process alongside P2's services.
  const accountModule = await import(pathToFileURL(path.join(appRoot, 'electron/accounts.mjs')).href);
  accounts = await accountModule.installAccounts({ app, ipcMain, safeStorage, window, appUrl });
  await window.loadFile(path.join(__dirname, '../dist/index.html'));
}).catch(() => { console.error('Desktop initialization failed. Check the local account configuration.'); app.quit(); });
app.on('before-quit', event => {
  if (quitting || !accounts) return;
  event.preventDefault(); quitting = true;
  accounts.close().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
