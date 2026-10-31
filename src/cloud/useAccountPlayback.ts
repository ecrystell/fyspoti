import { useEffect, useRef, useState } from 'react';
import type { PlaybackSession, ScopedPlaybackBridge } from '@fyspoti/contracts';
import { createAccountRendererPlayer } from '../../p2/src/account-renderer-player';
import type { PlayerState } from '../../p2/src/contracts';

const idle: PlayerState = { generation: 0, status: 'idle', currentItemId: null, queue: [], positionMs: 0, durationMs: 0, volume: .5, repeat: 'off', shuffle: false };
export function useAccountPlayback(bridge: ScopedPlaybackBridge | undefined, previewFor: (id: string) => string | undefined) {
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [state, setState] = useState(idle);
  const [mode, setMode] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const current = useRef<Awaited<ReturnType<typeof createAccountRendererPlayer>> | null>(null);
  const preview = useRef(previewFor); preview.current = previewFor;
  const generation = useRef(-1);
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    let unsubscribePlayer = () => {};
    const accept = (next: PlaybackSession) => {
      if (disposed || next.generation < generation.current) return;
      setSession(next);
      if (next.generation === generation.current) return;
      generation.current = next.generation;
      // Dispose synchronously on IPC delivery, before React renders another user.
      unsubscribePlayer(); current.current?.dispose(); current.current = null;
      setState(idle); setMode(undefined); setError(''); setReady(false);
      if (!next.available) return;
      void createAccountRendererPlayer(bridge, next, id => preview.current(id), () => {
        if (next.generation === generation.current) setMode(current.current?.mode());
      }, message => { if (next.generation === generation.current) setError(message); }, undefined, undefined, () => !disposed && next.generation === generation.current).then(created => {
        if (disposed || next.generation !== generation.current) { created.dispose(); return; }
        current.current = created;
        unsubscribePlayer = created.player.subscribe(value => { setState(value); setMode(created.mode()); });
        setReady(true);
      }).catch(cause => { if (!disposed && next.generation === generation.current) setError(cause instanceof Error ? cause.message : 'Playback unavailable.'); });
    };
    const unsubscribe = bridge.subscribe(accept);
    void bridge.session().then(result => { if (result.ok) accept(result.value); else setError(result.error.message); });
    const close = () => { current.current?.dispose(); };
    window.addEventListener('beforeunload', close);
    return () => { disposed = true; unsubscribe(); unsubscribePlayer(); current.current?.dispose(); current.current = null; generation.current = -1; window.removeEventListener('beforeunload', close); };
  }, [bridge]);
  return { player: ready ? current.current?.player ?? null : null, retryFullTrack: () => current.current?.retryFullTrack(), state, mode, session, error };
}
