import { contextBridge, ipcRenderer } from 'electron';
import '../p2/src/electron-preload.ts';
import type { CloudBridge } from '@fyspoti/contracts';
contextBridge.exposeInMainWorld('desktop', {
  windowAction(action: string) { if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action); },
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
      const handler = (_event: Electron.IpcRendererEvent, state: import('@fyspoti/contracts').DesktopState) => listener(state);
      ipcRenderer.on('fyspoti:state', handler);
      return () => ipcRenderer.removeListener('fyspoti:state', handler);
    },
  } satisfies CloudBridge,
});
