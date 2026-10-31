const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  windowAction: action => {
    if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action);
  },
});

contextBridge.exposeInMainWorld('p2', {
  jobs: () => ipcRenderer.invoke('p2:jobs'),
  artifacts: () => ipcRenderer.invoke('p2:artifacts'),
  cancel: id => ipcRenderer.invoke('p2:cancel', id),
  retry: id => ipcRenderer.invoke('p2:retry', id),
  removeArtifact: id => ipcRenderer.invoke('p2:remove-artifact', id),
  artifactUrl: id => ipcRenderer.invoke('p2:artifact-url', id),
  selectLocalFiles: () => ipcRenderer.invoke('p2:select-local'),
  loadPlayer: () => ipcRenderer.invoke('p2:load-player'),
  savePlayer: state => ipcRenderer.invoke('p2:save-player', state),
  resolveStream: track => ipcRenderer.invoke('p2:resolve-stream', track),
  downloadTrack: track => ipcRenderer.invoke('p2:download-track', track),
  onJob: listener => {
    const handler = (_event, job) => listener(job);
    ipcRenderer.on('p2:job', handler);
    return () => ipcRenderer.removeListener('p2:job', handler);
  },
});
