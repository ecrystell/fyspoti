import { BrowserAudio } from './browser-audio.ts';
import type { ListeningEvent, PlayableSource, QueueItem, SourceResolver } from './contracts.ts';
import type { P2Bridge } from './electron-preload.ts';
import { bindMediaSession } from './media-session.ts';
import { Player } from './player.ts';
import { OfflineFirstResolver, type CatalogSourceAdapter } from './source-resolver.ts';

export async function createRendererPlayer(bridge: P2Bridge, catalog: CatalogSourceAdapter, emitListening: (event: ListeningEvent) => void): Promise<{ player: Player; dispose(): void }> {
  const offline = new OfflineFirstResolver({
    getArtifact: async trackId => (await bridge.artifacts()).find(a => a.trackId === trackId),
    playbackUrl: id => bridge.artifactUrl(id)
  }, catalog);
  const resolver: SourceResolver = {
    resolve(item: QueueItem, signal: AbortSignal): Promise<PlayableSource> {
      if (item.trackId.startsWith('local:')) {
        const id = item.trackId.slice(6);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.reject(new Error('Invalid local file ID'));
        return Promise.resolve({ uri: `p2-media://local/${id}`, local: true, seekable: true });
      }
      return offline.resolve(item, signal);
    }
  };
  const player = new Player(new BrowserAudio(), resolver, emitListening);
  const saved = await bridge.loadPlayer();
  if (saved) player.restore(saved);
  const unbindMedia = bindMediaSession(player);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = player.subscribe(state => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void bridge.savePlayer(state); }, 500);
  });
  return {
    player,
    dispose() {
      if (timer) clearTimeout(timer);
      void bridge.savePlayer(player.snapshot());
      unsubscribe(); unbindMedia(); player.stop();
    }
  };
}
