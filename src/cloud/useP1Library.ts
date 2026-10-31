import { useEffect, useRef, useState } from 'react';
import type { CloudBridge, DesktopState, LibraryAction, Playlist, PlaylistItem } from '@fyspoti/contracts';
import { loadPreviewCatalog } from './catalog';

/** Bind P1's existing UI to account services without reading prototype data. */
export function useP1Library(bridge: CloudBridge | undefined, route: string) {
  const [state, setState] = useState<DesktopState | null>(null);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof loadPreviewCatalog>>>([]);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [catalogError, setCatalogError] = useState('');
  const [knownLikes, setKnownLikes] = useState<Record<string, boolean>>({});
  const version = useRef(-1), owner = useRef<string | null>(null), epoch = useRef(0);
  owner.current = state?.account.userId ?? null;
  useEffect(() => {
    if (!bridge) return;
    const accept = (next: DesktopState) => { if (next.version >= version.current) { version.current = next.version; setState(next); } };
    const unsubscribe = bridge.subscribe(accept); void bridge.getState().then(accept); return unsubscribe;
  }, [bridge]);
  useEffect(() => { setKnownLikes({}); }, [state?.account.userId]);
  async function reloadCatalog(signal = new AbortController().signal) {
    const current = ++epoch.current; setLoading(true);
    try { const next = await loadPreviewCatalog(signal); if (current === epoch.current) { setRecords(next); setCatalogError(''); } }
    catch { if (!signal.aborted && current === epoch.current) setCatalogError('Online catalog could not refresh. Retry when connected.'); }
    finally { if (current === epoch.current) setLoading(false); }
  }
  useEffect(() => { if (!bridge) return; const abort = new AbortController(); void reloadCatalog(abort.signal); return () => { abort.abort(); epoch.current++; }; }, [bridge]);
  useEffect(() => {
    if (!bridge || state?.account.phase !== 'authenticated' || !route.startsWith('playlist/')) return;
    if (state.library.phase === 'ready' && state.library.playlist?.id !== route.slice(9)) void bridge.load(route.slice(9));
  }, [bridge, route, state?.account.phase, state?.library.phase, state?.library.playlist?.id]);
  useEffect(() => {
    const id = state?.account.userId; if (!bridge || !id || state?.account.phase !== 'authenticated') return;
    let retired = false;
    void Promise.all(records.map(async record => { const result = await bridge.getTrackLike(record.track.id); return [record.track.id, result.ok ? result.value.liked : null] as const; })).then(values => {
      if (!retired && owner.current === id) setKnownLikes(Object.fromEntries(values.filter((value): value is readonly [string, boolean] => value[1] !== null)));
    });
    return () => { retired = true; };
  }, [bridge, records, state?.account.userId, state?.library.phase]);
  const library = state?.library;
  const cloudItems: Record<string, PlaylistItem[]> = library?.playlist ? { [library.playlist.id]: library.items } : {};
  async function run(action: LibraryAction) {
    if (!bridge) throw new Error('Account services unavailable.');
    const result = await bridge.run(action); if (!result.ok) throw new Error(result.error.message); return result.value;
  }
  return { state, library, records, loading, catalogError, cloudItems, reloadCatalog, run,
    signedIn: state?.account.phase === 'authenticated', busy: library?.phase === 'loading' || library?.phase === 'mutation-pending',
    isLiked: (id: string) => knownLikes[id] ?? library?.likedTracks.some(like => like.trackId === id) ?? false,
    create: async (title: string) => await run({ type: 'create', title }) as Playlist,
    async append(id: string, trackId: string) {
      const record = records.find(record => record.track.id === trackId);
      if (!record) throw new Error('Adding this saved recording needs matching catalog metadata.');
      return run({ type: 'append', playlistId: id, track: record.track });
    },
  };
}
