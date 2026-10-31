export type RepeatMode = 'off' | 'one' | 'all';
export type PlayerStatus = 'idle' | 'resolving' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface QueueItem {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  durationMs?: number;
  candidateId?: string;
}

export interface PlayableSource {
  uri: string;
  mimeType?: string;
  expiresAt?: number;
  seekable: boolean;
  local: boolean;
}

export interface PlayerState {
  generation: number;
  status: PlayerStatus;
  currentItemId: string | null;
  queue: QueueItem[];
  positionMs: number;
  durationMs: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  error?: string;
}

export interface SourceResolver {
  resolve(item: QueueItem, signal: AbortSignal): Promise<PlayableSource>;
}

export interface AudioEngine {
  load(source: PlayableSource, generation: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(ms: number): void;
  setVolume(value: number): void;
  unload(): void;
  onEvent(listener: (event: AudioEvent) => void): () => void;
}

export type AudioEvent =
  | { type: 'playing' | 'buffering' | 'ended'; generation: number }
  | { type: 'position'; generation: number; positionMs: number; durationMs: number }
  | { type: 'error'; generation: number; message: string };

export interface ListeningEvent {
  id: string;
  trackId: string;
  queueItemId: string;
  listenedMs: number;
  startedAt: number;
  endedAt: number;
  privacyEligible: boolean;
}

export type DownloadStatus = 'queued' | 'resolving' | 'transferring' | 'processing' | 'verifying' | 'retry-wait' | 'complete' | 'failed' | 'cancelled';

export interface DownloadRequest {
  trackId: string;
  candidateId: string;
  url: string;
  sourceKind: 'direct' | 'spotdl';
  matchedAudioUrl?: string;
  expectedBytes?: number;
  title?: string;
}

export interface DownloadJob extends DownloadRequest {
  id: string;
  status: DownloadStatus;
  bytesDone: number;
  bytesTotal?: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  artifactId?: string;
}

export interface LocalArtifact {
  id: string;
  trackId: string;
  candidateId: string;
  fileName: string;
  bytes: number;
  mimeType: string;
  verifiedAt: number;
}
