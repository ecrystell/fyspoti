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

export class YoutubeSource {
  constructor(private readonly python: string, private readonly script: string) {}

  async resolve(track: TrackRequest, signal?: AbortSignal): Promise<PlayableSource> {
    const value = await this.run('resolve', track, signal);
    return { uri: value.uri as string, mimeType: value.mimeType as string, expiresAt: value.expiresAt as number, seekable: true, local: false };
  }

  async candidate(track: TrackRequest): Promise<{ id: string; url: string }> {
    const value = await this.run('candidate', track);
    const videoId = value.videoId as string;
    return { id: `ytmusic:${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  private run(type: 'resolve' | 'candidate', track: TrackRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!track.trackId || track.trackId.length > 200 || !track.title || track.title.length > 300 || !track.artist || track.artist.length > 300 || !Number.isFinite(track.durationMs) || track.durationMs <= 0 || track.durationMs > 3600000) throw new Error('Invalid track metadata');
    // Account mode passes whole queue items here, so forward only the fields the worker reads.
    const videoId = /^ytmusic:([A-Za-z0-9_-]{11})$/.exec(track.candidateId ?? '')?.[1];
    const request = { type, trackId: track.trackId, title: track.title, artist: track.artist, durationMs: track.durationMs, ...(videoId ? { videoId } : {}) };
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Source lookup cancelled')); return; }
      const child = spawn(this.python, [this.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Source lookup timed out')); }, 120000);
      const cancel = () => { child.kill(); clearTimeout(timer); reject(new Error('Source lookup cancelled')); };
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20000) child.kill(); });
      child.stdin.on('error', () => { /* Spawn/close handlers report the source failure. */ });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000); });
      child.on('error', error => { signal?.removeEventListener('abort', cancel); clearTimeout(timer); reject(error); });
      child.on('close', () => {
        signal?.removeEventListener('abort', cancel);
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
