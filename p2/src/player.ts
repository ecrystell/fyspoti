import type { AudioEngine, AudioEvent, ListeningEvent, PlayerState, QueueItem, RepeatMode, SourceResolver } from './contracts.ts';

type Listener = (state: PlayerState) => void;

export class Player {
  private readonly engine: AudioEngine;
  private readonly resolver: SourceResolver;
  private readonly emitListening: (event: ListeningEvent) => void;
  private readonly random: () => number;
  private state: PlayerState = { generation: 0, status: 'idle', currentItemId: null, queue: [], positionMs: 0, durationMs: 0, volume: 1, repeat: 'off', shuffle: false };
  private listeners = new Set<Listener>();
  private abort?: AbortController;
  private history: string[] = [];
  private upcoming: string[] = [];
  private startedAt = 0;
  private listenedMs = 0;
  private lastClock = 0;
  private lastPositionMs = 0;
  private eligible = true;
  private timer?: ReturnType<typeof setTimeout>;
  private needsLoad = false;
  private recoveryAttempts = 0;

  constructor(engine: AudioEngine, resolver: SourceResolver, emitListening: (event: ListeningEvent) => void = () => {}, random: () => number = Math.random) {
    this.engine = engine; this.resolver = resolver; this.emitListening = emitListening; this.random = random;
    engine.onEvent(event => this.onAudio(event));
  }

  snapshot(): PlayerState { return { ...this.state, queue: [...this.state.queue] }; }
  upcomingItems(): QueueItem[] { return this.upcoming.map(id => this.state.queue.find(item => item.id === id)).filter((item): item is QueueItem => Boolean(item)); }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  private update(changes: Partial<PlayerState>): void { this.state = { ...this.state, ...changes }; for (const listener of this.listeners) listener(this.snapshot()); }

  setQueue(items: QueueItem[], startId?: string): Promise<void> {
    this.validateQueue(items);
    this.finishListening();
    this.abort?.abort(); this.engine.unload();
    this.history = [];
    this.upcoming = items.map(i => i.id);
    this.needsLoad = false;
    this.update({ queue: [...items], currentItemId: null, status: 'idle', positionMs: 0, durationMs: 0, generation: this.state.generation + 1 });
    return startId ? this.playItem(startId) : Promise.resolve();
  }

  enqueue(item: QueueItem): void {
    if (this.state.queue.some(q => q.id === item.id)) throw new Error('Duplicate queue item ID');
    this.update({ queue: [...this.state.queue, item] });
    this.upcoming.unshift(item.id);
  }

  reorderQueue(ids: string[]): void {
    if (ids.length !== this.upcoming.length || new Set(ids).size !== ids.length || ids.some(id => !this.upcoming.includes(id))) throw new Error('Invalid upcoming order');
    this.upcoming = [...ids];
    this.update({});
  }

  removeUpcoming(ids: string[]): void {
    const removed = new Set(ids);
    this.upcoming = this.upcoming.filter(id => !removed.has(id));
    this.update({});
  }

  restore(saved: PlayerState): void {
    this.validateQueue(saved.queue);
    this.abort?.abort(); this.engine.unload();
    this.history = [];
    this.upcoming = saved.queue.map(i => i.id);
    if (saved.currentItemId) this.upcoming = this.upcoming.filter(id => id !== saved.currentItemId);
    this.needsLoad = Boolean(saved.currentItemId);
    this.update({ ...saved, generation: this.state.generation + 1, status: saved.currentItemId ? 'paused' : 'idle', error: undefined });
  }

  async playItem(id: string, startMs = 0, recovering = false): Promise<void> {
    const item = this.state.queue.find(q => q.id === id);
    if (!item) throw new Error('Queue item not found');
    this.finishListening();
    this.abort?.abort(); this.engine.unload();
    const generation = this.state.generation + 1;
    const controller = new AbortController();
    this.abort = controller;
    if (this.state.currentItemId && this.state.currentItemId !== id) this.history.push(this.state.currentItemId);
    this.upcoming = this.upcoming.filter(value => value !== id);
    this.startedAt = Date.now(); this.listenedMs = 0; this.lastClock = 0; this.lastPositionMs = startMs; this.needsLoad = false;
    if (!recovering) this.recoveryAttempts = 0;
    this.update({ generation, currentItemId: id, status: 'resolving', positionMs: startMs, durationMs: item.durationMs ?? 0, error: undefined });
    try {
      const source = await this.resolver.resolve(item, controller.signal);
      if (generation !== this.state.generation || controller.signal.aborted) return;
      if (source.expiresAt && source.expiresAt <= Date.now()) throw new Error('Source expired');
      this.update({ status: 'buffering' });
      await this.engine.load(source, generation);
      if (generation !== this.state.generation || controller.signal.aborted) return;
      if (startMs > 0 && source.seekable) this.engine.seek(startMs);
      await this.engine.play();
      if (generation === this.state.generation && !controller.signal.aborted) this.update({ status: 'playing' });
    } catch (error) {
      if (generation === this.state.generation && !controller.signal.aborted) this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  async resume(): Promise<void> { if (this.state.status !== 'paused') return; if (this.needsLoad && this.state.currentItemId) { await this.playItem(this.state.currentItemId, this.state.positionMs); return; } await this.engine.play(); this.update({ status: 'playing' }); }
  pause(): void { if (!['playing', 'buffering', 'resolving'].includes(this.state.status)) return; this.accountTime(); if (this.state.status !== 'playing') { this.abort?.abort(); this.needsLoad = true; } this.engine.pause(); this.update({ status: 'paused' }); }
  seek(ms: number): void { if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid seek'); this.accountTime(); const position = Math.min(ms, this.state.durationMs || ms); this.engine.seek(position); this.lastPositionMs = position; this.update({ positionMs: position }); }
  setVolume(value: number): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid volume'); this.engine.setVolume(value); this.update({ volume: value }); }
  setRepeat(mode: RepeatMode): void { this.update({ repeat: mode }); }
  setShuffle(enabled: boolean): void { this.update({ shuffle: enabled }); }
  setPrivacyEligible(eligible: boolean): void { this.eligible = eligible; }

  async next(): Promise<void> {
    if (!this.upcoming.length && this.state.repeat === 'all') this.upcoming = this.state.queue.map(i => i.id).filter(id => id !== this.state.currentItemId);
    const index = this.state.shuffle ? Math.floor(this.random() * this.upcoming.length) : 0;
    const id = this.upcoming[index];
    if (id) await this.playItem(id);
    else { this.accountTime(); this.finishListening(); this.update({ status: 'ended' }); }
  }

  async previous(): Promise<void> {
    if (this.state.positionMs > 3000) { this.seek(0); return; }
    const id = this.history.pop();
    if (!id) { this.seek(0); return; }
    const current = this.state.currentItemId;
    if (current) this.upcoming.unshift(current);
    await this.playItem(id);
    this.history.pop();
  }

  stop(): void { this.finishListening(); this.abort?.abort(); this.engine.unload(); this.needsLoad = false; if (this.timer) clearTimeout(this.timer); this.update({ generation: this.state.generation + 1, status: 'idle', currentItemId: null, positionMs: 0 }); }
  sleepAfter(ms: number): void { if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid timer'); if (this.timer) clearTimeout(this.timer); this.timer = ms ? setTimeout(() => this.pause(), ms) : undefined; }

  private onAudio(event: AudioEvent): void {
    if (event.generation !== this.state.generation) return;
    if (event.type === 'position') { this.accountTime(event.positionMs); this.update({ positionMs: event.positionMs, durationMs: event.durationMs }); }
    else if (event.type === 'playing') { this.lastClock = Date.now(); this.update({ status: 'playing' }); }
    else if (event.type === 'buffering') { this.accountTime(); this.update({ status: 'buffering' }); }
    else if (event.type === 'ended') { if (this.state.repeat === 'one' && this.state.currentItemId) void this.playItem(this.state.currentItemId); else void this.next(); }
    else if (event.type === 'error') {
      this.accountTime();
      if (this.recoveryAttempts < 1 && this.state.currentItemId) {
        this.recoveryAttempts++;
        void this.playItem(this.state.currentItemId, this.state.positionMs, true);
      } else this.update({ status: 'error', error: event.message });
    }
  }

  private accountTime(positionMs?: number): void {
    const now = Date.now();
    if (this.state.status === 'playing' && this.lastClock) {
      const wall = Math.max(0, now - this.lastClock);
      const media = positionMs === undefined ? Math.min(wall, 2000) : Math.max(0, positionMs - this.lastPositionMs);
      this.listenedMs += Math.min(media, wall + 1000);
    }
    if (positionMs !== undefined) this.lastPositionMs = positionMs;
    this.lastClock = now;
  }
  private finishListening(): void { this.accountTime(); const item = this.state.queue.find(q => q.id === this.state.currentItemId); if (item && this.listenedMs > 0) this.emitListening({ id: crypto.randomUUID(), trackId: item.trackId, queueItemId: item.id, listenedMs: this.listenedMs, startedAt: this.startedAt, endedAt: Date.now(), privacyEligible: this.eligible }); this.listenedMs = 0; this.lastClock = 0; }
  private validateQueue(items: QueueItem[]): void { if (new Set(items.map(i => i.id)).size !== items.length || items.some(i => !i.id || !i.trackId)) throw new Error('Invalid queue'); }
}
