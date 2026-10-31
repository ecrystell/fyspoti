import { contextBridge, ipcRenderer } from 'electron';
import '../p2/src/electron-preload.ts';
import type { CloudBridge, ScopedPlaybackBridge, PlaybackSession } from '@fyspoti/contracts';
import type { CatalogBridge } from '../src/services/desktop-catalog.ts';
contextBridge.exposeInMainWorld('desktop', {
  windowAction(action: string) { if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action); },
  catalog: {
    search: (query, cursor) => ipcRenderer.invoke('catalog:search', query, cursor),
    getTrack: id => ipcRenderer.invoke('catalog:get-track', id),
    getAlbum: id => ipcRenderer.invoke('catalog:get-album', id),
    getArtist: id => ipcRenderer.invoke('catalog:get-artist', id),
    findCandidates: (id, hint) => ipcRenderer.invoke('catalog:find-candidates', id, hint),
  } satisfies CatalogBridge,
  playback: {
    session: () => ipcRenderer.invoke('playback:session'),
    load: generation => ipcRenderer.invoke('playback:load', generation),
    save: (generation, snapshot) => ipcRenderer.invoke('playback:save', { generation, snapshot }),
    resolve: (generation, track) => ipcRenderer.invoke('playback:resolve', { generation, track }),
    subscribe(listener) {
      const callback = (_event: Electron.IpcRendererEvent, session: PlaybackSession) => listener(session);
      ipcRenderer.on('playback:session', callback);
      return () => ipcRenderer.removeListener('playback:session', callback);
    },
  } satisfies ScopedPlaybackBridge,
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
    prepareLikedQueue: () => ipcRenderer.invoke('fyspoti:prepare-liked-queue'),
    getTrackLike: id => ipcRenderer.invoke('fyspoti:get-like', id),
    subscribe(listener) {
      const handler = (_event: Electron.IpcRendererEvent, state: import('@fyspoti/contracts').DesktopState) => listener(state);
      ipcRenderer.on('fyspoti:state', handler);
      return () => ipcRenderer.removeListener('fyspoti:state', handler);
    },
  } satisfies CloudBridge,
});
