import { contextBridge, ipcRenderer } from 'electron';
// Sandboxed preloads can only require 'electron', so P2's bridge is bundled in here.
import '../p2/src/electron-preload.ts';

const windowActions = ['minimize', 'maximize', 'close'];
contextBridge.exposeInMainWorld('desktop', {
  windowAction: (action: string) => { if (windowActions.includes(action)) ipcRenderer.send('window-action', action); },
});
