import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { installP2Desktop, registerP2MediaScheme } from '../p2/src/electron-main.ts';
import type { WorkerPaths } from '../p2/src/download-manager.ts';

registerP2MediaScheme();

// P2 never falls back to globally installed tools. Until a release bundles Python,
// FFprobe and FFmpeg, download jobs fail unless these paths are provided.
const env = (name: string): string => process.env[name] ?? '';
const worker: WorkerPaths = {
  python: env('FYSPOTI_PYTHON'),
  script: path.join(app.getAppPath(), 'p2', 'worker', 'worker.py'),
  ffprobe: env('FYSPOTI_FFPROBE'),
  ...(env('FYSPOTI_FFMPEG') ? { ffmpeg: env('FYSPOTI_FFMPEG') } : {}),
  ...(env('FYSPOTI_SPOTDL') ? { spotdl: env('FYSPOTI_SPOTDL') } : {}),
};

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1600, height: 940, minWidth: 1000, minHeight: 650, frame: false, backgroundColor: '#000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Provider and help links open in the system browser; the app window never navigates away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.on('window-action', (event, action) => {
    if (event.sender !== window.webContents) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  // The renderer falls back to its own player if these handlers are missing.
  try { await installP2Desktop(window, worker); } catch (error) { console.error('P2 desktop services failed to start', error); }
  await window.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
