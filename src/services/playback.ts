import { useEffect, useState } from 'react';
import { BrowserAudio } from '../../p2/src/browser-audio.ts';
import type { ListeningEvent, PlayableSource, PlayerState, QueueItem } from '../../p2/src/contracts.ts';
import type { P2Bridge } from '../../p2/src/electron-preload.ts';
import { bindMediaSession } from '../../p2/src/media-session.ts';
import { Player } from '../../p2/src/player.ts';
import { createRendererPlayer } from '../../p2/src/renderer-player.ts';
import type { CatalogSourceAdapter } from '../../p2/src/source-resolver.ts';
import { previewFor } from './catalog.ts';

export type { PlayerState, QueueItem };

// P2 owns queue and playback state. The renderer only issues commands and draws
// the latest snapshot, so it never keeps a second queue.

const previewSource: CatalogSourceAdapter = {
  async resolveStream(item: QueueItem): Promise<PlayableSource> {
    const uri = previewFor(item.trackId);
    if (!uri) throw new Error('No audio source is connected for this track yet.');
    return { uri, seekable: true, local: false };
  },
};

// P3 has no listening-history API yet, so finished sessions are not stored.
const recordListening = (_event: ListeningEvent): void => {};

const idle: PlayerState = { generation: 0, status: 'idle', currentItemId: null, queue: [], positionMs: 0, durationMs: 0, volume: 0.5, repeat: 'off', shuffle: false };

async function createPlayback(): Promise<{ player: Player; dispose(): void }> {
  const bridge = (window as { p2?: P2Bridge }).p2;
  if (bridge) {
    try { return await createRendererPlayer(bridge, previewSource, recordListening); }
    catch (error) { console.error('P2 desktop player unavailable; using renderer-only playback', error); }
  }
  const player = new Player(new BrowserAudio(), { resolve: item => previewSource.resolveStream(item, new AbortController().signal) }, recordListening);
  player.setVolume(idle.volume);
  const unbind = bindMediaSession(player);
  return { player, dispose() { unbind(); player.stop(); } };
}

export function usePlayback(): { player: Player | null; state: PlayerState } {
  const [player, setPlayer] = useState<Player | null>(null);
  const [state, setState] = useState<PlayerState>(idle);
  useEffect(() => {
    let disposed = false;
    let session: { player: Player; dispose(): void } | undefined;
    let unsubscribe = () => {};
    void createPlayback().then(created => {
      if (disposed) { created.dispose(); return; }
      session = created;
      unsubscribe = created.player.subscribe(setState);
      setPlayer(created.player);
    });
    const save = () => session?.dispose();
    window.addEventListener('beforeunload', save);
    return () => { disposed = true; window.removeEventListener('beforeunload', save); unsubscribe(); session?.dispose(); };
  }, []);
  return { player, state };
}

export function queueItem(trackId: string, title: string, artist: string, durationMs?: number): QueueItem {
  return { id: crypto.randomUUID(), trackId, title, artist, ...(durationMs ? { durationMs } : {}) };
}
