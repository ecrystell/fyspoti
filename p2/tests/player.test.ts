import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/player.ts';
import type { AudioEngine, AudioEvent, PlayableSource, QueueItem, SourceResolver } from '../src/contracts.ts';

class Engine implements AudioEngine {
  events: ((event: AudioEvent) => void)[] = [];
  loaded: number[] = [];
  async load(_source: PlayableSource, generation: number): Promise<void> { this.loaded.push(generation); }
  async play(): Promise<void> {}
  pause(): void {}
  seek(_ms: number): void {}
  setVolume(_value: number): void {}
  unload(): void {}
  onEvent(listener: (event: AudioEvent) => void): () => void { this.events.push(listener); return () => {}; }
  emit(event: AudioEvent): void { this.events.forEach(listener => listener(event)); }
}

const items: QueueItem[] = [
  { id: 'a', trackId: 'A', title: 'A', artist: 'Artist' },
  { id: 'b', trackId: 'B', title: 'B', artist: 'Artist' },
  { id: 'c', trackId: 'C', title: 'C', artist: 'Artist' }
];
const source: PlayableSource = { uri: 'https://example.test/a.wav', local: false, seekable: true };

test('late source resolution cannot replace a newer track', async () => {
  const engine = new Engine();
  const pending = new Map<string, (value: PlayableSource) => void>();
  const resolver: SourceResolver = { resolve: (item) => new Promise(resolve => pending.set(item.id, resolve)) };
  const player = new Player(engine, resolver);
  void player.setQueue(items, 'a');
  const newer = player.playItem('b');
  pending.get('b')!(source); await newer;
  pending.get('a')!(source); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(engine.loaded, [3]);
  assert.equal(player.snapshot().currentItemId, 'b');
});

test('queue, repeat, shuffle history and stale audio events', async () => {
  const engine = new Engine();
  const player = new Player(engine, { resolve: async () => source }, () => {}, () => 0.99);
  await player.setQueue(items, 'a');
  const old = player.snapshot().generation;
  player.setShuffle(true);
  await player.next();
  assert.equal(player.snapshot().currentItemId, 'c');
  engine.emit({ type: 'ended', generation: old });
  assert.equal(player.snapshot().currentItemId, 'c');
  await player.previous();
  assert.equal(player.snapshot().currentItemId, 'a');
  player.setRepeat('one');
  engine.emit({ type: 'ended', generation: player.snapshot().generation });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.snapshot().currentItemId, 'a');
});

test('pause during resolution and restore wait for an explicit resume', async () => {
  const engine = new Engine();
  let finish!: (value: PlayableSource) => void;
  const player = new Player(engine, { resolve: async () => new Promise(resolve => { finish = resolve; }) });
  const starting = player.setQueue(items, 'a');
  player.pause();
  finish(source); await starting;
  assert.equal(player.snapshot().status, 'paused');
  assert.equal(engine.loaded.length, 0);
  const snapshot = player.snapshot();
  const restoredEngine = new Engine();
  const restored = new Player(restoredEngine, { resolve: async () => source });
  restored.restore(snapshot);
  assert.equal(restored.snapshot().status, 'paused');
  assert.equal(restoredEngine.loaded.length, 0);
  await restored.resume();
  assert.equal(restored.snapshot().status, 'playing');
});
