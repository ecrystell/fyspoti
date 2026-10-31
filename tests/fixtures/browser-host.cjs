const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.FYSPOTI_USER_DATA);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(process.env.FYSPOTI_DEMO_TEST_URL);
});
app.on('window-all-closed', () => app.quit());
