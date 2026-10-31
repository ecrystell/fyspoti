import { spawn } from 'node:child_process';
import type { PlayableSource } from './contracts.ts';

export interface TrackRequest {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
  /** `ytmusic:<videoId>` the catalog already identified. When present, no search or match runs. */
  candidateId?: string;
}

const MAX_CACHED = 100;

interface CachedSource { source: Promise<PlayableSource>; expiresAt?: number }

export class YoutubeSource {
  // In-memory only: signed URLs are never persisted. A lookup takes several seconds, so
  // playback and prefetch share one in-flight lookup per recording and reuse the result.
  private readonly cache = new Map<string, CachedSource>();

  private readonly python: string;
  private readonly script: string;
  constructor(python: string, script: string) { this.python = python; this.script = script; }

  /** A cancelled caller stops waiting; the lookup itself finishes and stays cached for later. */
  resolve(track: TrackRequest, signal?: AbortSignal): Promise<PlayableSource> {
    if (signal?.aborted) return Promise.reject(new Error('Source lookup cancelled'));
    let source: Promise<PlayableSource>;
    try { source = this.lookup(track); } catch (error) { return Promise.reject(error); }
    if (!signal) return source;
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new Error('Source lookup cancelled'));
      signal.addEventListener('abort', cancel, { once: true });
      source.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
  }

  /** Starts resolving a track that is likely to play next. Failures surface when it is played. */
  prefetch(track: TrackRequest): void {
    this.resolve(track).catch(() => {});
  }

  async candidate(track: TrackRequest): Promise<{ id: string; url: string }> {
    const value = await this.run('candidate', track);
    const videoId = value.videoId as string;
    return { id: `ytmusic:${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  private lookup(track: TrackRequest): Promise<PlayableSource> {
    const videoId = videoIdOf(track);
    const key = videoId ? `video:${videoId}` : `track:${track.trackId}`;
    const hit = this.cache.get(key);
    // The URL must outlive the song (plus a minute for buffering and seeking) to be reused.
    if (hit && (hit.expiresAt === undefined || hit.expiresAt - Date.now() > track.durationMs + 60000)) return hit.source;
    const entry: CachedSource = {
      source: this.run('resolve', track).then(value => ({ uri: value.uri as string, mimeType: value.mimeType as string, expiresAt: value.expiresAt as number, seekable: true, local: false })),
    };
    entry.source.then(source => { entry.expiresAt = source.expiresAt ?? 0; }, () => { if (this.cache.get(key) === entry) this.cache.delete(key); });
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    return entry.source;
  }

  private run(type: 'resolve' | 'candidate', track: TrackRequest): Promise<Record<string, unknown>> {
    if (!track.trackId || track.trackId.length > 200 || !track.title || track.title.length > 300 || !track.artist || track.artist.length > 300 || !Number.isFinite(track.durationMs) || track.durationMs <= 0 || track.durationMs > 3600000) throw new Error('Invalid track metadata');
    // Account mode passes whole queue items here, so forward only the fields the worker reads.
    const videoId = videoIdOf(track);
    const request = { type, trackId: track.trackId, title: track.title, artist: track.artist, durationMs: track.durationMs, ...(videoId ? { videoId } : {}) };
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [this.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Source lookup timed out')); }, 120000);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20000) child.kill(); });
      child.stdin.on('error', () => { /* Spawn/close handlers report the source failure. */ });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const response = JSON.parse(stdout);
          if (!response.ok) throw new Error(response.error || 'Source unavailable');
          resolve(response.value);
        } catch (error) { reject(error instanceof SyntaxError ? new Error(stderr || 'Source lookup failed') : error); }
      });
      child.stdin.end(JSON.stringify(request) + '\n');
    });
  }
}

function videoIdOf(track: TrackRequest): string | undefined {
  return /^ytmusic:([A-Za-z0-9_-]{11})$/.exec(track.candidateId ?? '')?.[1];
}
