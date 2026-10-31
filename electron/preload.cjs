const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  windowAction(action) { if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action); },
  cloud: {
    getState: () => ipcRenderer.invoke('fyspoti:state'),
    requestEmailCode: email => ipcRenderer.invoke('fyspoti:request-code', email),
    verifyEmailCode: (email, code) => ipcRenderer.invoke('fyspoti:verify-code', { email, code }),
    cancelEmailCode: () => ipcRenderer.invoke('fyspoti:cancel-code'),
    retryRestore: () => ipcRenderer.invoke('fyspoti:restore'),
    signOut: () => ipcRenderer.invoke('fyspoti:sign-out'),
    updateDisplayName: (displayName, context) => ipcRenderer.invoke('fyspoti:profile', { displayName, context }),
    load: playlistId => ipcRenderer.invoke('fyspoti:load', playlistId),
    loadMore: kind => ipcRenderer.invoke('fyspoti:load-more', kind),
    run: action => ipcRenderer.invoke('fyspoti:action', action),
    retryConflict: () => ipcRenderer.invoke('fyspoti:retry-conflict'),
    retryUncertain: () => ipcRenderer.invoke('fyspoti:retry-uncertain'),
    prepareQueue: id => ipcRenderer.invoke('fyspoti:prepare-queue', id),
    getTrackLike: id => ipcRenderer.invoke('fyspoti:get-like', id),
    subscribe(listener) {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('fyspoti:state', handler);
      return () => ipcRenderer.removeListener('fyspoti:state', handler);
    },
  },
});
