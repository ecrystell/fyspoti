import type { AudioEngine, AudioEvent, PlayableSource } from './contracts.ts';

// This runs in the renderer. The player owns state; the element only plays audio.
export class BrowserAudio implements AudioEngine {
  private audio?: HTMLAudioElement;
  private generation = 0;
  private volume = 1;
  private listeners = new Set<(event: AudioEvent) => void>();

  async load(source: PlayableSource, generation: number): Promise<void> {
    this.unload();
    this.generation = generation;
    const audio = new Audio();
    audio.preload = 'auto'; audio.volume = this.volume;
    audio.addEventListener('playing', () => this.emit({ type: 'playing', generation }));
    audio.addEventListener('waiting', () => this.emit({ type: 'buffering', generation }));
    audio.addEventListener('ended', () => this.emit({ type: 'ended', generation }));
    audio.addEventListener('timeupdate', () => this.emit({ type: 'position', generation, positionMs: audio.currentTime * 1000, durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0 }));
    audio.addEventListener('error', () => this.emit({ type: 'error', generation, message: audio.error?.message || 'Audio playback failed' }));
    audio.src = source.uri;
    this.audio = audio;
    audio.load();
  }
  play(): Promise<void> { return this.audio?.play() ?? Promise.reject(new Error('No source loaded')); }
  pause(): void { this.audio?.pause(); }
  seek(ms: number): void { if (this.audio) this.audio.currentTime = ms / 1000; }
  setVolume(value: number): void { this.volume = value; if (this.audio) this.audio.volume = value; }
  unload(): void { const old = this.audio; this.audio = undefined; if (old) { old.pause(); old.removeAttribute('src'); old.load(); } }
  onEvent(listener: (event: AudioEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: AudioEvent): void { for (const listener of this.listeners) listener(event); }
}
