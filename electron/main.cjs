const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { registerP2MediaScheme, installP2Desktop } = require('./p2-main.cjs');

registerP2MediaScheme();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1600, height: 940, minWidth: 1000, minHeight: 650,
    frame: false, backgroundColor: '#000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const projectRoot = path.join(__dirname, '..');
  const python = process.env.FYSPOTI_P2_PYTHON || path.join(projectRoot, 'p2', '.venv', 'Scripts', 'python.exe');
  try {
    await installP2Desktop(window, {
      python,
      script: path.join(projectRoot, 'p2', 'worker', 'worker.py'),
      ffprobe: process.env.FYSPOTI_FFPROBE || 'ffprobe',
    }, path.join(projectRoot, 'p2', 'worker', 'youtube_source.py'));
  } catch (error) {
    console.error('P2 service could not start:', error);
  }
  ipcMain.on('window-action', (event, action) => {
    if (event.sender !== window.webContents) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
