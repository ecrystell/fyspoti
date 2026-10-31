import type { Player } from './player.ts';

export function bindMediaSession(player: Player): () => void {
  if (!('mediaSession' in navigator)) return () => {};
  const session = navigator.mediaSession;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => { void player.resume(); }],
    ['pause', () => player.pause()],
    ['nexttrack', () => { void player.next(); }],
    ['previoustrack', () => { void player.previous(); }],
    ['seekto', details => { if (details.seekTime !== undefined) player.seek(details.seekTime * 1000); }]
  ];
  for (const [action, handler] of actions) session.setActionHandler(action, handler);
  const unsubscribe = player.subscribe(state => {
    const item = state.queue.find(q => q.id === state.currentItemId);
    session.metadata = item ? new MediaMetadata({ title: item.title, artist: item.artist }) : null;
    session.playbackState = state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';
    if (item && state.durationMs > 0) {
      try { session.setPositionState({ duration: state.durationMs / 1000, position: Math.min(state.positionMs, state.durationMs) / 1000, playbackRate: 1 }); } catch { /* duration can change while buffering */ }
    }
  });
  return () => {
    unsubscribe();
    for (const [action] of actions) session.setActionHandler(action, null);
    session.metadata = null; session.playbackState = 'none';
    try { session.setPositionState(); } catch { /* Optional in older engines. */ }
  };
}
