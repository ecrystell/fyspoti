import type { ScopedPlaybackBridge, PlaybackSession, PlaybackSnapshot } from '@fyspoti/contracts';
import type { AudioEngine, QueueItem } from './contracts.ts';
import { BrowserAudio } from './browser-audio.ts';
import { Player } from './player.ts';
import { bindMediaSession } from './media-session.ts';

export async function createAccountRendererPlayer(bridge: ScopedPlaybackBridge, session: PlaybackSession, previewFor: (trackId: string) => string | undefined,
  changed: () => void, warn: (message: string) => void, engine: AudioEngine = new BrowserAudio(), bindMedia = bindMediaSession, isActive: () => boolean = () => true) {
  let live = true;
  let modes: PlaybackSnapshot['modes'] = {};
  const failed = new Set<string>();
  let player!: Player;
  const unbindErrors = engine.onEvent(event => {
    if (event.type === 'error' && player) { const id = player.snapshot().currentItemId; if (id && modes[id] === 'full-track') failed.add(id); }
  });
  const mode = (item: QueueItem, value: 'full-track' | 'preview') => { modes[item.id] = value; changed(); };
  player = new Player(engine, { async resolve(item, signal) {
    const preview = previewFor(item.trackId);
    if (signal.aborted || !live) throw new Error('Playback session changed.');
    if (preview && (modes[item.id] === 'preview' || failed.has(item.id))) {
      mode(item, 'preview'); return { uri: preview, local: false, seekable: true };
    }
    const source = await bridge.resolve(session.generation, item);
    if (signal.aborted || !live) throw new Error('Playback session changed.');
    if (source.ok) { mode(item, 'full-track'); return source.value; }
    if (source.error.code !== 'AUTH_REQUIRED' && source.error.code !== 'FORBIDDEN' && preview) {
      mode(item, 'preview'); return { uri: preview, local: false, seekable: true };
    }
    throw new Error(source.error.message);
  } });
  let loaded: Awaited<ReturnType<ScopedPlaybackBridge['load']>>;
  try { loaded = await bridge.load(session.generation); }
  catch (error) { player.stop(); unbindErrors(); throw error; }
  if (!isActive()) { player.stop(); unbindErrors(); throw new Error('Playback session changed.'); }
  if (!loaded.ok) { player.stop(); unbindErrors(); throw new Error(loaded.error.message); }
  if (loaded.value) {
    modes = { ...loaded.value.modes }; player.restore(loaded.value.state);
    const upcoming = new Set(loaded.value.upcomingIds);
    player.removeUpcoming(player.upcomingItems().filter(item => !upcoming.has(item.id)).map(item => item.id));
    player.reorderQueue(loaded.value.upcomingIds); player.setVolume(loaded.value.state.volume);
  }
  const unbind = bindMedia(player);
  let lastSave = Promise.resolve();
  const capture = (): PlaybackSnapshot => {
    const state = player.snapshot(); delete state.error;
    const ids = new Set(state.queue.map(item => item.id));
    return { state, modes: Object.fromEntries(Object.entries(modes).filter(([id]) => ids.has(id))), upcomingIds: player.upcomingItems().map(item => item.id) };
  };
  const unsubscribe = player.subscribe(() => {
    if (!live) return;
    // Send immediately: main serializes and captures ownership before logout.
    lastSave = bridge.save(session.generation, capture()).then(result => { if (!result.ok && live && result.error.code !== 'AUTH_REQUIRED') warn(result.error.message); }).catch(() => { if (live) warn('The playback queue could not be saved.'); });
  });
  return {
    player, mode: () => { const id = player.snapshot().currentItemId; return id ? modes[id] : undefined; },
    async retryFullTrack() { const id = player.snapshot().currentItemId; if (!id || !live) return; delete modes[id]; failed.delete(id); await player.playItem(id); },
    async flush() { await lastSave; },
    dispose() { if (!live) return; live = false; unsubscribe(); unbindErrors(); unbind(); player.stop(); void player.setQueue([]); modes = {}; },
  };
}
