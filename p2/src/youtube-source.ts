import { spawn } from 'node:child_process';
import type { PlayableSource } from './contracts.ts';

export interface TrackRequest {
  trackId: string;
  title: string;
  artist: string;
  durationMs: number;
}

export class YoutubeSource {
  constructor(private readonly python: string, private readonly script: string) {}

  async resolve(track: TrackRequest): Promise<PlayableSource> {
    const value = await this.run('resolve', track);
    return { uri: value.uri as string, mimeType: value.mimeType as string, expiresAt: value.expiresAt as number, seekable: true, local: false };
  }

  async candidate(track: TrackRequest): Promise<{ id: string; url: string }> {
    const value = await this.run('candidate', track);
    const videoId = value.videoId as string;
    return { id: `ytmusic:${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  private run(type: 'resolve' | 'candidate', track: TrackRequest): Promise<Record<string, unknown>> {
    if (!track.trackId || track.trackId.length > 200 || !track.title || track.title.length > 300 || !track.artist || track.artist.length > 300 || !Number.isFinite(track.durationMs) || track.durationMs <= 0 || track.durationMs > 3600000) throw new Error('Invalid track metadata');
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [this.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Source lookup timed out')); }, 120000);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 20000) child.kill(); });
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
      child.stdin.end(JSON.stringify({ type, ...track }) + '\n');
    });
  }
}
