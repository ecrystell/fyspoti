import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Heart, Home, LayoutList, ListMusic, LogOut, Maximize2, Minus, MoreHorizontal, Music2, Pause, Play, Plus, Search, Settings, SkipForward, Square, Volume2, X } from 'lucide-react';
import type { CloudBridge, DesktopState, LibraryAction, LibraryQueueItem, Playlist, TrackMetadataSnapshot } from '@fyspoti/contracts';
import { AccountDialog } from './AccountDialog';
import { loadPreviewCatalog, metadata, type PreviewRecord } from './catalog';
import './cloud.css';
import { useDialogFocus } from './useDialogFocus';

interface Row { id: string; trackId: string; snapshot: TrackMetadataSnapshot; itemId?: string }
const duration = (ms: number) => ms > 0 ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '—';
export function CloudApp({ bridge }: { bridge: CloudBridge }) {
  const [state, setState] = useState<DesktopState | null>(null);
  const version = useRef(-1);
  const [records, setRecords] = useState<PreviewRecord[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [route, setRoute] = useState('home');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('Custom order');
  const [accountOpen, setAccountOpen] = useState(false);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'profile' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [toast, setToast] = useState('');
  const [queue, setQueue] = useState<LibraryQueueItem[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(.5);
  const [position, setPosition] = useState(0);
  const [queueOpen, setQueueOpen] = useState(true);
  const [knownLikes, setKnownLikes] = useState<Record<string, boolean>>({});
  const editDialogRef = useDialogFocus(Boolean(dialog));
  const actionsDialogRef = useDialogFocus(Boolean(selected));
  const audio = useRef<HTMLAudioElement>(null);
  const accountId = state?.account.userId ?? null;
  const accountRef = useRef(accountId); accountRef.current = accountId;
  const catalog = new Map(records.map(record => [record.track.id, record]));
  const library = state?.library;
  const playlistId = route.startsWith('playlist/') ? route.slice(9) : undefined;
  const selectedPlaylist = library?.playlist ?? null;
  const playlist = playlistId && selectedPlaylist?.id === playlistId ? selectedPlaylist : null;
  const signedIn = state?.account.phase === 'authenticated';
  const pending = library?.phase === 'loading' || library?.phase === 'mutation-pending';
  const active = queue.find(item => item.id === current);
  const preview = active ? catalog.get(active.trackId)?.preview : undefined;
  useEffect(() => {
    const accept = (next: DesktopState) => { if (next && typeof next.version === 'number' && next.version >= version.current) { version.current = next.version; setState(next); } };
    const unsubscribe = bridge.subscribe(accept); void bridge.getState().then(accept);
    return unsubscribe;
  }, [bridge]);
  useEffect(() => {
    const abort = new AbortController();
    void loadPreviewCatalog(abort.signal).then(setRecords).catch(() => { if (!abort.signal.aborted) setCatalogError('Online previews are unavailable. Your saved library is still available.'); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    audio.current?.pause(); if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); }
    setQueue([]); setCurrent(null); setPlaying(false); setPosition(0); setKnownLikes({});
    setRoute('home'); setSelected(null); setDialog(null); setToast('');
  }, [accountId]);
  useEffect(() => {
    if (signedIn && playlistId && library?.phase === 'ready' && library.playlist?.id !== playlistId) void bridge.load(playlistId);
  }, [signedIn, playlistId, library?.phase, library?.playlist?.id, bridge]);
  useEffect(() => {
    if (!signedIn || !accountId) return;
    let cancelled = false;
    const ids = [...new Set([...records.map(record => record.track.id), ...(library?.items.map(item => item.trackId) ?? [])])];
    void Promise.all(ids.map(async id => { const result = await bridge.getTrackLike(id); return [id, result.ok ? result.value.liked : null] as const; })).then(values => {
      if (!cancelled && accountRef.current === accountId) setKnownLikes(previous => ({ ...previous, ...Object.fromEntries(values.filter((value): value is readonly [string, boolean] => value[1] !== null)) }));
    });
    return () => { cancelled = true; };
  }, [accountId, signedIn, records, library?.phase, library?.items, bridge]);
  useEffect(() => {
    const element = audio.current; if (!element) return;
    element.volume = volume;
    if (playing && preview) void element.play().catch(() => { setPlaying(false); setToast('Preview unavailable.'); });
    else element.pause();
  }, [playing, current, preview, volume]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select')) return;
      if (event.code === 'Space' && active) { event.preventDefault(); setPlaying(value => !value); }
      if (event.key === 'Escape') { setSelected(null); setDialog(null); setAccountOpen(false); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [active]);
  function navigate(next: string) { setSelected(null); setQuery(''); setRoute(next); }
  function requireAccount() { if (!signedIn) { setAccountOpen(true); return false; } return true; }
  function artwork(trackId: string) { return catalog.get(trackId)?.track.artwork[0]?.url; }
  function image(trackId: string) { const url = artwork(trackId); return url ? <img src={url} alt=""/> : <div className="cloud-art"><Music2/></div>; }
  async function run(action: LibraryAction) {
    const result = await bridge.run(action);
    if (!result.ok) setToast(result.error.message);
    return result;
  }
  async function toggleLike(row: Row) {
    if (!requireAccount()) return;
    const liked = knownLikes[row.trackId] ?? library?.likedTracks.some(item => item.trackId === row.trackId) ?? false;
    const result = await run({ type: 'likeSnapshot', trackId: row.trackId, metadataSnapshot: row.snapshot, liked: !liked });
    if (result.ok && accountRef.current === accountId) setKnownLikes(previous => ({ ...previous, [row.trackId]: !liked }));
  }
  async function playRow(row: Row) {
    if (!catalog.get(row.trackId)?.preview) { setToast('No preview is currently available for this saved track.'); return; }
    const owner = accountId;
    if (playlistId && row.itemId) {
      const result = await bridge.prepareQueue(playlistId);
      if (!result.ok) { setToast(result.error.message); return; }
      if (accountRef.current !== owner) return;
      setQueue(result.value.items); setCurrent(row.itemId);
    } else {
      const item = { id: crypto.randomUUID(), trackId: row.trackId, title: row.snapshot.title, artist: row.snapshot.artistNames.join(', '), durationMs: row.snapshot.durationMs };
      setQueue([item]); setCurrent(item.id);
    }
    if (audio.current) audio.current.currentTime = 0;
    setPosition(0); setPlaying(true);
  }
  function next() {
    const index = queue.findIndex(item => item.id === current);
    const nextItem = queue[index + 1];
    if (!nextItem) { setPlaying(false); return; }
    setCurrent(nextItem.id); setPosition(0); setPlaying(Boolean(catalog.get(nextItem.trackId)?.preview));
  }
  async function submitDialog() {
    if (dialog === 'profile' && state?.profile) {
      const result = await bridge.updateDisplayName(name, { mutationId: crypto.randomUUID(), expectedRevision: state.profile.revision });
      if (!result.ok) { setToast(result.error.message); return; }
    } else if (dialog === 'create') {
      const result = await run({ type: 'create', title: name });
      if (!result.ok) return;
      navigate(`playlist/${(result.value as Playlist).id}`);
    } else if (playlist && dialog === 'rename') {
      if (!(await run({ type: 'rename', playlistId: playlist.id, title: name })).ok) return;
    } else if (playlist && dialog === 'delete') {
      if (!(await run({ type: 'delete', playlistId: playlist.id })).ok) return;
      navigate('home');
    }
    setDialog(null);
  }
  let rows: Row[] = playlistId ? (playlist ? library!.items.map(item => ({ id: item.id, itemId: item.id, trackId: item.trackId, snapshot: item.metadataSnapshot })) : [])
    : route === 'liked' ? (library?.likedTracks.flatMap(item => item.metadataSnapshot ? [{ id: item.id!, trackId: item.trackId, snapshot: item.metadataSnapshot }] : []) ?? [])
    : records.map(record => ({ id: record.track.id, trackId: record.track.id, snapshot: metadata(record.track) }));
  rows = rows.filter(row => `${row.snapshot.title} ${row.snapshot.artistNames.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  if (sort === 'Title') rows = [...rows].sort((a, b) => a.snapshot.title.localeCompare(b.snapshot.title));
  const reorderEnabled = Boolean(playlist && !pending && !query && sort === 'Custom order' && !library?.cursors.items);
  const icon = (label: string, Icon: typeof Home, action: () => void, disabled = false) => <button className="icon" title={label} aria-label={label} disabled={disabled} onClick={action}><Icon size={22}/></button>;
  if (!state) return <div className="cloud-start" role="status">Connecting desktop account service…</div>;
  return <>
    <audio ref={audio} src={preview} onTimeUpdate={() => setPosition((audio.current?.currentTime ?? 0) * 1000)} onEnded={next}/>
    <header><div className="nav-left">{icon('Home', Home, () => navigate('home'))}</div>
      <div className="searchbar"><Search/><label><input aria-label="Search visible tracks" placeholder="What do you want to play?" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
      <div className="nav-right">{signedIn ? <><button className="avatar" aria-label="Your profile" onClick={() => navigate('profile')}>{state.profile?.displayName[0]?.toUpperCase() ?? 'L'}</button>{icon('Sign out', LogOut, () => { void bridge.signOut(); })}</> : <button className="pill" onClick={() => setAccountOpen(true)}>Sign in</button>}
        {icon('Minimize', Minus, () => window.desktop?.windowAction('minimize'))}{icon('Maximize', Square, () => window.desktop?.windowAction('maximize'))}{icon('Close', X, () => window.desktop?.windowAction('close'))}</div>
    </header>
    <div className={`workspace cloud-workspace ${queueOpen ? '' : 'no-panel'}`}>
      <aside className="library view-default-list"><div className="library-title"><LayoutList/><b>Your Library</b>{icon('Create playlist', Plus, () => { if (requireAccount()) { setName('My Playlist'); setDialog('create'); } }, pending)}</div>
        <div className="chips"><button onClick={() => navigate('home')}>Playlists</button></div>
        <div className="library-scroll">{signedIn ? <><button className="library-item" onClick={() => navigate('liked')}><div className="liked-cover">♥</div><div><b>Liked Songs</b><span>{library?.likedTracks.length ?? 0} loaded songs</span></div></button>
          {library?.playlists.map(list => <button className={`library-item ${playlistId === list.id ? 'chosen' : ''}`} key={list.id} onClick={() => navigate(`playlist/${list.id}`)}><div className="cloud-art"><ListMusic/></div><div><b>{list.title}</b><span>Private playlist</span></div></button>)}
          {!library?.playlists.length && library?.phase === 'ready' && <p className="cloud-help">No playlists yet. Create your first playlist above.</p>}
          {library?.cursors.playlists && <button className="pill" disabled={pending} onClick={() => bridge.loadMore('playlists')}>Load more playlists</button>}</> : <div className="cloud-help"><h3>Your music, saved to your account</h3><p>Sign in to create playlists and save songs. Local prototype data stays separate.</p><button className="pill" onClick={() => setAccountOpen(true)}>Sign in</button></div>}</div>
        {icon('Settings', Settings, () => navigate('settings'))}
      </aside>
      <main className="content">
        {(state.account.storageNotice || state.account.error) && <div className="notice" role="status">{state.account.storageNotice || state.account.error?.message}{state.account.phase === 'unavailable' && <button onClick={() => bridge.retryRestore()}>Retry connection</button>}</div>}
        {catalogError && <div className="notice">{catalogError}</div>}
        {library?.error && <div className="notice" role="alert">{library.error.message}{library.phase === 'conflict' ? <button disabled={pending} onClick={() => bridge.retryConflict()}>Retry edit after refresh</button> : library.failedContext && library.error.retryable ? <button disabled={pending} onClick={() => bridge.retryUncertain()}>Retry saved operation</button> : <button onClick={() => bridge.load(playlistId)}>Refresh library</button>}</div>}
        {route === 'profile' || route === 'settings' ? <div className="page-body"><h1>{route === 'profile' ? state.profile?.displayName ?? 'Your profile' : 'Settings'}</h1><h2>Account</h2><p>{state.account.email ?? 'Not signed in'}</p><p>{state.account.persistent ? 'Your sign-in is securely saved on this device.' : 'This sign-in lasts until the app closes.'}</p>
          {signedIn && <><button className="pill" onClick={() => { setName(state.profile?.displayName ?? 'Listener'); setDialog('profile'); }}>Edit display name</button><button className="pill" onClick={() => bridge.signOut()}>Sign out</button></>}
          <h2>Your private playlists</h2>{library?.playlists.map(list => <button className="pill" key={list.id} onClick={() => navigate(`playlist/${list.id}`)}>{list.title}</button>)}<h2>Playback</h2><p>Online previews are available where the catalog supplies them. Full-track playback and downloads are not connected to this screen.</p></div>
          : <><div className="hero"><div className="hero-liked">{route === 'liked' ? '♥' : <ListMusic size={70}/>}</div><div><span>{playlistId ? 'Private playlist' : route === 'liked' ? 'Your collection' : 'Discover music'}</span><h1>{playlist?.title ?? (playlistId ? 'Loading playlist…' : route === 'liked' ? 'Liked Songs' : 'Music for you')}</h1><p>{playlistId ? state.profile?.displayName : 'Online metadata and preview audio'}</p></div></div>
            <div className="page-body"><div className="toolbar">{playlist && <><button className="green-play" aria-label="Play playlist preview" disabled={!rows.length || pending} onClick={() => rows[0] && playRow(rows[0])}><Play fill="black"/></button><button className="pill" disabled={pending} onClick={() => { setName(playlist.title); setDialog('rename'); }}>Rename playlist</button><button className="pill" disabled={pending} onClick={() => setDialog('delete')}>Delete playlist</button></>}
              <select aria-label="Track order" value={sort} onChange={event => setSort(event.target.value)}><option>Custom order</option><option>Title</option></select><button className="icon" aria-label="Refresh library" onClick={() => bridge.load(playlistId)} disabled={!signedIn || pending}><ChevronLeft className="cloud-refresh"/></button></div>
              {pending && <p role="status">Loading your library…</p>}
              <div className="table"><div className="tr th"><span>#</span><span>Title</span><span>Album</span><span className="date-added">Visibility</span><span>Duration</span></div>
                {rows.map((row, index) => <div className="tr" data-item-id={row.itemId} key={row.id} draggable={reorderEnabled} onDragStart={event => event.dataTransfer.setData('text/plain', row.itemId!)} onDragOver={event => { if (reorderEnabled) event.preventDefault(); }} onDrop={event => {
                  if (!reorderEnabled || !playlist) return;
                  const from = event.dataTransfer.getData('text/plain'); const ids = library!.items.map(item => item.id); const source = ids.indexOf(from); const target = ids.indexOf(row.itemId!);
                  if (source < 0 || target < 0) return; ids.splice(source, 1); ids.splice(target, 0, from); void run({ type: 'reorder', playlistId: playlist.id, itemIds: ids });
                }} onDoubleClick={() => playRow(row)}>
                  <button aria-label={`Play preview ${row.snapshot.title}`} onClick={() => playRow(row)}>{active?.id === row.itemId && playing ? <Volume2 size={17}/> : index + 1}</button>
                  <div className="song">{image(row.trackId)}<div><strong>{row.snapshot.title}</strong><span>{row.snapshot.artistNames.join(', ')}</span></div></div><span>—</span><span className="date-added">{playlistId ? 'Private' : '—'}</span>
                  <div className="row-actions"><button disabled={pending} aria-label={`${(knownLikes[row.trackId] ?? (route === 'liked')) ? 'Unlike' : 'Like'} ${row.snapshot.title}`} onClick={() => toggleLike(row)}><Heart size={17} fill={(knownLikes[row.trackId] ?? (route === 'liked')) ? 'currentColor' : 'none'}/></button><span>{duration(row.snapshot.durationMs)}</span><button aria-label={`Actions for ${row.snapshot.title}`} onClick={() => setSelected(selected?.id === row.id ? null : row)}><MoreHorizontal size={18}/></button></div>
                </div>)}
              </div>
              {!rows.length && !pending && <p>{playlistId ? 'This playlist is empty.' : route === 'liked' ? 'No liked songs yet.' : 'No tracks match your search.'}</p>}
              {(playlistId ? library?.cursors.items : route === 'liked' ? library?.cursors.likes : null) && <button className="pill" disabled={pending} onClick={() => bridge.loadMore(playlistId ? 'items' : 'likes')}>Load more songs</button>}
              {playlist && !reorderEnabled && <p className="cloud-help">To drag tracks into a new order, load all songs, clear the search, and choose Custom order.</p>}
            </div></>}
      </main>
      {queueOpen && <aside className="right-panel cloud-queue"><div className="panel-title"><h2>Queue</h2>{icon('Close queue', X, () => setQueueOpen(false))}</div><p>Preview playback</p>{queue.map(item => <button className="library-item" key={item.id} onClick={() => { setCurrent(item.id); setPlaying(Boolean(catalog.get(item.trackId)?.preview)); }}><div><b>{item.title}</b><span>{item.artist}</span></div></button>)}</aside>}
    </div>
    <footer className="player cloud-player"><div className="cloud-now">{active ? <>{image(active.trackId)}<div><strong>{active.title}</strong><p>{active.artist}</p></div></> : <span>Choose a track preview</span>}</div><div className="cloud-transport">{icon(playing ? 'Pause' : 'Play', playing ? Pause : Play, () => setPlaying(value => !value), !active || !preview)}{icon('Next', SkipForward, next, !queue.length)}<span>{duration(position)} / {duration(active?.durationMs ?? 0)}</span></div><div className="cloud-volume">{icon('Show queue', ListMusic, () => setQueueOpen(value => !value))}<Volume2/><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))}/></div></footer>
    {selected && <div className="overlay" onClick={() => setSelected(null)}><section ref={actionsDialogRef} className="dialog" role="dialog" aria-modal="true" aria-label="Track actions" onClick={event => event.stopPropagation()}><h2>{selected.snapshot.title}</h2>
      {library?.playlists.map(list => <button className="pill" key={list.id} disabled={pending || !catalog.has(selected.trackId)} onClick={async () => {
        await bridge.load(list.id); const result = await run({ type: 'append', playlistId: list.id, track: catalog.get(selected.trackId)!.track });
        if (result.ok) { setSelected(null); setToast(`Added to ${list.title}`); }
      }}>Add to {list.title}</button>)}
      {!catalog.has(selected.trackId) && <p>Adding this saved recording to another playlist needs matching catalog metadata.</p>}
      {playlist && selected.itemId && <button className="pill" disabled={pending} onClick={async () => { if ((await run({ type: 'remove', playlistId: playlist.id, itemId: selected.itemId! })).ok) setSelected(null); }}>Remove this item</button>}
      <button className="pill" onClick={() => setSelected(null)}>Close</button></section></div>}
    {dialog && <div className="overlay"><section ref={editDialogRef} className="dialog" role="dialog" aria-modal="true" aria-label={dialog === 'create' ? 'Create playlist' : dialog === 'rename' ? 'Rename playlist' : dialog === 'profile' ? 'Edit profile' : 'Delete playlist'}><h2>{dialog === 'create' ? 'Create playlist' : dialog === 'rename' ? 'Rename playlist' : dialog === 'profile' ? 'Edit display name' : 'Delete playlist?'}</h2>
      {dialog === 'delete' ? <p>This removes the private playlist from your library.</p> : <label>Name<input autoFocus aria-label="Name" maxLength={dialog === 'profile' ? 80 : 200} value={name} onChange={event => setName(event.target.value)}/></label>}
      <button className="save" disabled={pending || (dialog !== 'delete' && !name.trim())} onClick={submitDialog}>{dialog === 'delete' ? 'Delete' : 'Save'}</button><button className="pill" onClick={() => setDialog(null)}>Cancel</button></section></div>}
    {accountOpen && <AccountDialog bridge={bridge} account={state.account} close={() => setAccountOpen(false)}/>}
    {toast && <div className="toast" role="status" onClick={() => setToast('')}>{toast}</div>}
  </>;
}
