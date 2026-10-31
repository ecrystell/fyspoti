const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (process.env.FYSPOTI_USER_DATA) app.setPath('userData', path.resolve(process.env.FYSPOTI_USER_DATA));
let accounts;
let quitting = false;
app.whenReady().then(async () => {
  const appUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  const window = new BrowserWindow({
    width: 1600, height: 940, minWidth: 1000, minHeight: 650, frame: false,
    show: process.env.FYSPOTI_E2E !== '1', backgroundColor: '#000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const { trustedSender } = await import('./ipc.mjs');
  ipcMain.on('window-action', (event, action) => {
    if (!trustedSender(event, window, appUrl)) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== appUrl) event.preventDefault(); });
  const { installAccounts } = await import('./accounts.mjs');
  accounts = await installAccounts({ app, ipcMain, safeStorage, window, appUrl });
  await window.loadURL(appUrl);
}).catch(() => { console.error('Desktop initialization failed. Check the local account configuration.'); app.quit(); });
app.on('before-quit', event => {
  if (quitting || !accounts) return;
  event.preventDefault(); quitting = true;
  accounts.close().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
