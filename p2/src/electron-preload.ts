import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadJob, LocalArtifact, PlayerState, QueueItem } from './contracts.ts';

export interface P2Bridge {
  jobs(): Promise<DownloadJob[]>;
  artifacts(): Promise<LocalArtifact[]>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  removeArtifact(id: string): Promise<void>;
  artifactUrl(id: string): Promise<string>;
  selectLocalFiles(): Promise<QueueItem[]>;
  loadPlayer(): Promise<PlayerState | null>;
  savePlayer(state: PlayerState): Promise<void>;
  onJob(listener: (job: DownloadJob) => void): () => void;
}

const bridge: P2Bridge = {
  jobs: () => ipcRenderer.invoke('p2:jobs'),
  artifacts: () => ipcRenderer.invoke('p2:artifacts'),
  cancel: id => ipcRenderer.invoke('p2:cancel', id),
  retry: id => ipcRenderer.invoke('p2:retry', id),
  removeArtifact: id => ipcRenderer.invoke('p2:remove-artifact', id),
  artifactUrl: id => ipcRenderer.invoke('p2:artifact-url', id),
  selectLocalFiles: () => ipcRenderer.invoke('p2:select-local'),
  loadPlayer: () => ipcRenderer.invoke('p2:load-player'),
  savePlayer: state => ipcRenderer.invoke('p2:save-player', state),
  onJob: listener => {
    const handler = (_event: Electron.IpcRendererEvent, job: DownloadJob) => listener(job);
    ipcRenderer.on('p2:job', handler);
    return () => ipcRenderer.removeListener('p2:job', handler);
  }
};
contextBridge.exposeInMainWorld('p2', bridge);
