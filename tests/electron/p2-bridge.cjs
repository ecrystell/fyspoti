const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerP2MediaScheme, installP2Desktop } = require('../../electron/p2-main.cjs');

const projectRoot = path.join(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fyspoti-p2-shell-'));
app.setPath('userData', temp);
registerP2MediaScheme();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, 'dist-electron', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const p2 = await installP2Desktop(window, {
    python: path.join(projectRoot, 'p2', '.venv', 'Scripts', 'python.exe'),
    script: path.join(projectRoot, 'p2', 'worker', 'worker.py'),
    ffprobe: 'ffprobe',
  }, path.join(projectRoot, 'p2', 'worker', 'youtube_source.py'));
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const audioFile = path.join(temp, 'fixture.wav');
  fs.writeFileSync(audioFile, wav);
  const item = await p2.localFiles.add(audioFile);
  // Exercise the bridge independently of account UI and live catalog requests.
  const fixturePage = path.join(temp, 'index.html');
  fs.writeFileSync(fixturePage, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src p2-media:"><title>P2 bridge fixture</title>');
  await window.loadFile(fixturePage);
  const result = await window.webContents.executeJavaScript(`(async () => ({
    p2: typeof window.p2,
    jobs: Array.isArray(await window.p2.jobs()),
    player: await window.p2.loadPlayer(),
    audio: (await fetch('p2-media://local/${item.trackId.slice(6)}')).ok,
  }))()`);
  if (result.p2 !== 'object' || !result.jobs || result.player !== null || !result.audio) throw new Error('P2 bridge smoke test failed');
  console.log('P2 Electron bridge: OK');
  if (process.env.FYSPOTI_SMOKE_RESULT) fs.writeFileSync(process.env.FYSPOTI_SMOKE_RESULT, 'ok');
  window.close();
  app.quit();
}).catch(error => { console.error(error); if (process.env.FYSPOTI_SMOKE_RESULT) fs.writeFileSync(process.env.FYSPOTI_SMOKE_RESULT, String(error)); app.exit(1); });
