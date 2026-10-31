import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronDown, ExternalLink, FileArchive, Heart, ListMusic, LoaderCircle, LockKeyhole, Pause, ShieldCheck, Upload, X } from 'lucide-react';
import { ImportFormatError, applyImportEntry, parseSpotifyExport, previewSpotifyImport, readSpotifyArchive, type ImportOutcome, type ImportPreview, type ImportPreviewEntry } from '@fyspoti/catalog';
import { LibraryError, type DesktopState, type Library } from '@fyspoti/contracts';
import { AccountDialog } from './cloud/AccountDialog';
import { createImportLibrary } from './services/import-library';
import './import.css';

type Props = { library: Library | null; onSignIn(): void; onImported(): void; onConnected?(library: Library, email: string): void; onOpenPlaylist?(id: string): void };
type Phase = 'choose' | 'review' | 'running' | 'paused' | 'complete';
type Active = { index: number; saved: number; total: number };
const MAX_ARCHIVE = 256 * 1024 * 1024;
const count = (n: number, word: string) => n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');
const resolved = (entry: ImportPreviewEntry) => entry.rows.filter(row => row.resolution.status === 'resolved');
function confirmed(entry: ImportPreviewEntry, outcome?: ImportOutcome) {
  return outcome?.status === 'complete' ? entry.counts.resolved : outcome?.resume ? resolved(entry).filter(row => row.row.position < outcome.resume!.nextPosition).length : 0;
}
function skipped(entry: ImportPreviewEntry) {
  const labels: Record<string,string> = { episode: 'podcast episode', audiobook: 'audiobook', 'local-track': 'local file', malformed: 'unreadable row' };
  return Object.entries(entry.skipped).filter(([,n]) => n > 0).map(([reason,n]) => count(n, labels[reason] ?? reason)).join(', ');
}

export function SpotifyImport(props: Props) {
  const inputId = useId(); const input = useRef<HTMLInputElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const bridge = window.desktop?.cloud;
  const [account, setAccount] = useState<DesktopState | null>(null); const version = useRef(-1);
  const [authOpen, setAuthOpen] = useState(false);
  const owner = account?.account.phase === 'authenticated' ? account.account.userId : null;
  const desktopLibrary = useMemo(() => bridge && owner ? createImportLibrary(bridge, owner) : null, [bridge, owner]);
  const library = bridge ? desktopLibrary : props.library;
  const libraryRef = useRef(library); libraryRef.current = library;
  const propsRef = useRef(props); propsRef.current = props;
  const [fileName, setFileName] = useState(''); const [fileSize, setFileSize] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [chosen, setChosen] = useState<number[]>([]);
  const [outcomes, setOutcomes] = useState<Record<number,ImportOutcome>>({});
  const [phase, setPhase] = useState<Phase>('choose'); const [reading, setReading] = useState(false);
  const [error, setError] = useState(''); const [dragging, setDragging] = useState(false); const dragDepth = useRef(0);
  const [active, setActive] = useState<Active | null>(null); const [stopRequested, setStopRequested] = useState(false);
  const stop = useRef(false); const generation = useRef(0); const mounted = useRef(true); const lastOwner = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; generation.current++; }; }, []);
  useEffect(() => {
    if (!bridge) return;
    const accept = (next: DesktopState) => { if (mounted.current && next.version >= version.current) { version.current = next.version; setAccount(next); } };
    const unsubscribe = bridge.subscribe(accept); void bridge.getState().then(accept); return unsubscribe;
  }, [bridge]);
  useEffect(() => {
    if (lastOwner.current && lastOwner.current !== owner) {
      generation.current++; stop.current = true; setPreview(null); setChosen([]); setOutcomes({}); setFileName(''); setPhase('choose'); setReading(false); setActive(null); setError('The account changed. Choose the export again for this account.');
    }
    lastOwner.current = owner;
  }, [owner]);
  useEffect(() => { if (desktopLibrary && owner) propsRef.current.onConnected?.(desktopLibrary, account?.account.email ?? ''); }, [desktopLibrary, owner]);
  const busy = reading || phase === 'running';
  async function choose(files: FileList | File[]) {
    if (busy) return;
    const token = ++generation.current; setError(''); setDragging(false); setPreview(null); setChosen([]); setOutcomes({}); setActive(null); setPhase('choose');
    if (files.length !== 1) { setError('Choose one Spotify ZIP file at a time.'); return; }
    const file = files[0]!;
    if (!/\.zip$/i.test(file.name)) { setError('Choose the ZIP from Spotify’s Account data export. Other file types are not supported.'); return; }
    if (file.size > MAX_ARCHIVE) { setError('This ZIP is larger than 256 MB. Choose Spotify’s Account data package.'); return; }
    setFileName(file.name); setFileSize(file.size); setReading(true);
    try {
      const next = await previewSpotifyImport(parseSpotifyExport(readSpotifyArchive(new Uint8Array(await file.arrayBuffer()))));
      if (!mounted.current || token !== generation.current) return;
      setPreview(next); setChosen(next.entries.map((_,index) => index)); setPhase('review');
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) { if (mounted.current && token === generation.current) setError(cause instanceof ImportFormatError ? cause.message : 'This export could not be read. Choose the original ZIP from Spotify and try again.'); }
    finally { if (mounted.current && token === generation.current) setReading(false); }
  }
  function drop(event: DragEvent) { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!busy) void choose(event.dataTransfer.files); }
  function reset() { generation.current++; stop.current = true; setPreview(null); setOutcomes({}); setChosen([]); setFileName(''); setPhase('choose'); setError(''); setActive(null); setStopRequested(false); }
  async function run() {
    if (!preview || phase === 'running') return;
    if (!library) { if (bridge) setAuthOpen(true); else props.onSignIn(); return; }
    const indices = chosen.filter(index => outcomes[index]?.status !== 'complete'); if (!indices.length) return;
    const token = ++generation.current; const currentLibrary = library; const done = { ...outcomes };
    setPhase('running'); setError(''); stop.current = false; setStopRequested(false);
    for (const index of indices) {
      if (stop.current || token !== generation.current || !mounted.current) break;
      const entry = preview.entries[index]!; const prior = done[index];
      const resume = prior?.status === 'interrupted' ? prior.resume ?? undefined : undefined;
      let saved = confirmed(entry, prior); setActive({ index, saved, total: entry.counts.resolved });
      const guard = () => {
        if (token !== generation.current || libraryRef.current !== currentLibrary || !mounted.current) throw new LibraryError('AUTH_REQUIRED', 'The account changed.');
        if (stop.current) throw new LibraryError('UNAVAILABLE', 'Import paused.');
      };
      const checked: Library = {
        ...currentLibrary,
        async createPlaylist(title) { guard(); return currentLibrary.createPlaylist(title); },
        async addPlaylistItem(id, item) {
          guard();
          try { const result = await currentLibrary.addPlaylistItem(id, item); saved++; if (mounted.current && token === generation.current) setActive({ index, saved, total: entry.counts.resolved }); return result; }
          catch (cause) {
            if (cause instanceof LibraryError && cause.code === 'CONFLICT') {
              // A revision conflict does not prove a lost reply was saved. Verify the
              // original position and contents before the legacy resume helper skips it.
              let cursor: string | undefined;
              do {
                guard(); const page = await currentLibrary.listPlaylistItems(id, cursor);
                const existing = page.items.find(row => row.orderingKey === item.orderingKey);
                if (existing && existing.trackId === item.trackId && JSON.stringify(existing.metadataSnapshot) === JSON.stringify(item.metadataSnapshot)) return existing;
                if (existing) break;
                cursor = page.nextCursor ?? undefined;
              } while (cursor);
              throw new LibraryError('UNAVAILABLE', 'The playlist changed. Review it before resuming.', true);
            }
            if (cause instanceof LibraryError) throw cause;
            throw new LibraryError('UNAVAILABLE', 'Connection interrupted.', true);
          }
        },
      };
      try { done[index] = await applyImportEntry(checked, entry, resume); }
      catch { done[index] = { status: 'interrupted', resume: resume ?? null, imported: 0, error: { code: 'UNAVAILABLE', retryable: true } }; }
      if (!mounted.current || token !== generation.current) return;
      setOutcomes({ ...done });
      if (done[index]!.status !== 'complete') break;
    }
    if (!mounted.current || token !== generation.current) return;
    setActive(null);
    setPhase(chosen.every(index => done[index]?.status === 'complete') ? 'complete' : 'paused');
    propsRef.current.onImported();
  }
  const entries = preview?.entries ?? [];
  const remaining = chosen.filter(index => outcomes[index]?.status !== 'complete');
  const selectedTracks = chosen.reduce((total,index) => total + entries[index]!.counts.resolved, 0);
  const completed = Object.values(outcomes).filter(outcome => outcome.status === 'complete').length;
  const savedTracks = entries.reduce((total,entry,index) => total + confirmed(entry,outcomes[index]),0);
  const allSelected = entries.length > 0 && chosen.length === entries.length;
  const totalSkipped = entries.reduce((total,entry) => total + Object.values(entry.skipped).reduce((a,b) => a+b,0) + entry.counts.ambiguous + entry.counts.unmatched,0);
  const step = phase === 'choose' ? 0 : phase === 'review' ? 1 : 2;
  const accountBusy = Boolean(bridge && (!account || ['restoring','verifying','sending-code'].includes(account.account.phase)));
  const fileLabel = fileSize < 1024 * 1024 ? Math.max(1,Math.round(fileSize/1024)) + ' KB' : (fileSize / 1024 / 1024).toFixed(1) + ' MB';
  return <div className="page-body spotify-import" onKeyDown={event => { if (event.code === 'Space' && (event.target as HTMLElement).closest('button,summary,input')) event.stopPropagation(); }}>
    <div className="import-heading"><div className="import-source-icon"><ListMusic size={30}/></div><div><span className="import-eyebrow">YOUR LIBRARY</span><h1 ref={heading} tabIndex={-1} className="small-heading">Import from Spotify</h1><p>Your playlists. A new home. Bring the music you’ve saved into Fyspoti.</p></div></div>
    <ol className="import-stepper" aria-label="Import steps">{['Choose export','Review playlists','Import'].map((label,index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? 'is-done' : index === step ? 'is-current' : ''}><span>{index < step ? <Check size={14}/> : index+1}</span>{label}{index < 2 && <ArrowRight size={14} aria-hidden/>}</li>)}</ol>
    <input id={inputId} ref={input} type="file" accept=".zip,application/zip,application/x-zip-compressed" aria-label="Spotify export ZIP" hidden onChange={event => { const files = event.currentTarget.files; if (files?.length) void choose(files); event.currentTarget.value = ''; }}/>
    {!preview && <>
      <div className={'import-drop '+(dragging ? 'is-dragging ' : '')+(reading ? 'is-reading' : '')} onDragEnter={event => { event.preventDefault(); if (!busy) { dragDepth.current++; setDragging(true); } }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) setDragging(false); }} onDrop={drop}>
        <div className="import-upload-icon">{reading ? <LoaderCircle className="import-spin" size={36}/> : <FileArchive size={36}/>}</div>
        <h2>{reading ? 'Reading your export…' : 'Drop your Spotify ZIP here'}</h2><p>{reading ? 'Preparing a preview. Nothing is being saved.' : 'Use the original Account data ZIP. No need to unzip it.'}</p>
        <button className="import-primary" disabled={reading} onClick={() => input.current?.click()}><Upload size={16}/>{reading ? 'Reading ZIP…' : 'Choose ZIP file'}</button><span className="import-file-limit">ZIP files · up to 256 MB</span>
      </div>
      <div className="import-privacy"><ShieldCheck size={18}/><p>Previewed on this computer. Only selected playlist and song metadata is saved after you confirm. Account, payment and contact files are ignored.</p></div>
      <details className="import-help"><summary>Need your Spotify export?<ChevronDown size={16}/></summary><ol><li>Open Spotify’s account privacy page and request <b>Account data</b> under <b>Download your data</b>.</li><li>Wait for Spotify’s email, then download the ZIP.</li><li>Choose that ZIP here and select what to bring over.</li></ol><button className="pill" onClick={() => window.open('https://www.spotify.com/account/privacy/','_blank','noopener,noreferrer')}>Open Spotify privacy settings<ExternalLink size={14}/></button><p>Extended streaming history and technical logs aren’t library exports.</p></details>
    </>}
    {error && <div className="import-alert" role="alert"><X size={18}/><div><strong>Import needs attention</strong><p>{error}</p></div><button aria-label="Dismiss import error" onClick={() => setError('')}><X size={16}/></button></div>}
    {preview && <>
      <div className="import-file-bar"><FileArchive size={22}/><div><strong>{fileName}</strong><span>{fileLabel} · Ready to review</span></div><button className="pill" disabled={busy} onClick={() => input.current?.click()}>Change file</button></div>
      <div className="import-stats"><div><b>{entries.filter(entry => entry.kind === 'playlist').length}</b><span>Playlists found</span></div><div><b>{entries.find(entry => entry.kind === 'liked-songs')?.counts.resolved ?? 0}</b><span>Liked songs found</span></div><div><b>{entries.reduce((total,entry) => total+entry.counts.resolved,0).toLocaleString()}</b><span>Songs ready</span></div><div><b>{entries.reduce((total,entry) => total+entry.counts.duplicates,0)}</b><span>Duplicates kept</span></div></div>
      {phase === 'complete' ? <div className="import-result" role="status"><CheckCircle2 size={30}/><div><h2>Your music is here</h2><p>{count(completed,'playlist')} imported with {count(savedTracks,'song')}. Existing playlists weren’t changed.</p></div><button className="pill" onClick={reset}>Import another ZIP</button></div> : <>
        <div className="import-review-heading"><div><h2>{entries.length ? 'Choose what to import' : 'No playlists or saved songs found'}</h2><p>{entries.length ? 'Each selection becomes a new private playlist, keeping its order and duplicate songs.' : 'Choose the Account data ZIP containing Playlist or YourLibrary JSON files.'}</p></div><button disabled={busy} onClick={() => setChosen(allSelected ? entries.map((_,index) => index).filter(index => outcomes[index]?.status === 'complete') : entries.map((_,index) => index))}>{allSelected ? 'Deselect all' : 'Select all'}</button></div>
        {phase === 'running' && active && <div className="import-progress" role="status"><div><LoaderCircle className="import-spin" size={18}/><strong>Importing {entries[active.index]!.title}</strong><span>{active.saved.toLocaleString()} / {active.total.toLocaleString()} songs</span></div><progress aria-label="Current playlist import progress" max={Math.max(1,active.total)} value={active.saved}/><p>Keep this page open. {stopRequested ? 'Pausing after the current song is saved…' : 'You can pause after the current song.'}</p></div>}
        {phase === 'paused' && <div className="import-paused" role="status"><Pause size={20}/><div><strong>{stopRequested ? 'Import paused' : 'Import needs your attention'}</strong><p>Completed playlists are kept. Review the status below, then resume when you’re ready.</p></div></div>}
      </>}
      <ul className="import-entries" aria-label="Playlists in your export">{entries.map((entry,index) => {
        const outcome = outcomes[index]; const complete = outcome?.status === 'complete'; const interrupted = outcome?.status === 'interrupted';
        return <li className={'import-entry '+(chosen.includes(index) ? 'is-selected ' : '')+(complete ? 'is-complete' : '')} key={index}>
          <label className="import-entry-select"><input type="checkbox" aria-label={'Import '+entry.title} checked={chosen.includes(index)} disabled={busy || complete || phase === 'complete'} onChange={event => setChosen(previous => event.target.checked ? [...previous,index].sort((a,b)=>a-b) : previous.filter(value => value !== index))}/><span className={'import-list-icon '+(entry.kind === 'liked-songs' ? 'is-liked' : '')}>{entry.kind === 'liked-songs' ? <Heart size={23}/> : <ListMusic size={23}/>}</span><span className="import-entry-copy"><strong>{entry.title}</strong><span>{count(entry.counts.resolved,'song')}{entry.kind === 'liked-songs' ? ' · Saved as a private playlist' : ' · Playlist'}{entry.counts.duplicates > 0 ? ' · '+count(entry.counts.duplicates,'duplicate')+' kept' : ''}</span></span></label>
          <div className="import-entry-state">{complete ? <><CheckCircle2 size={16}/>Imported</> : phase === 'running' && active?.index === index ? <><LoaderCircle size={16} className="import-spin"/>Importing</> : interrupted ? <><Pause size={16}/>Needs resume</> : <><LockKeyhole size={14}/>Private</>}</div>
          {(entry.rows.length > 0 || skipped(entry)) && <details className="import-track-preview"><summary>Preview songs<ChevronDown size={14}/></summary><ol>{entry.rows.slice(0,5).map((row,rowIndex) => <li key={rowIndex}><span>{row.row.title}</span><span>{row.row.artistName}</span></li>)}</ol>{entry.rows.length > 5 && <p>And {(entry.rows.length-5).toLocaleString()} more in this list.</p>}{skipped(entry) && <p>Not imported: {skipped(entry)}.</p>}</details>}
          {interrupted && <p className="import-entry-error">{outcome.error.code === 'AUTH_REQUIRED' ? 'Sign in again to continue.' : outcome.error.code === 'RATE_LIMITED' ? 'The library is busy. Wait a moment before resuming.' : stopRequested ? 'Paused before the next song.' : 'The connection or library changed.'} {outcome.resume ? count(confirmed(entry,outcome),'song')+' confirmed. Resume continues in this playlist.' : 'Playlist creation wasn’t confirmed. Retrying may create another copy.'}</p>}
          {complete && props.onOpenPlaylist && <button className="import-open" onClick={() => props.onOpenPlaylist!(outcome.playlistId)}>Open playlist<ArrowRight size={14}/></button>}
        </li>;
      })}</ul>
      {(preview.notImported.savedAlbums > 0 || preview.notImported.savedArtists > 0 || totalSkipped > 0) && <div className="import-exclusions"><ShieldCheck size={18}/><div><strong>What stays behind</strong><p>{[preview.notImported.savedAlbums ? count(preview.notImported.savedAlbums,'saved album') : '',preview.notImported.savedArtists ? count(preview.notImported.savedArtists,'saved artist') : '',totalSkipped ? count(totalSkipped,'unsupported or unreadable item') : ''].filter(Boolean).join(', ')} aren’t imported. Spotify audio files and account details aren’t transferred.</p></div></div>}
      {phase !== 'complete' && <div className="import-footer"><div><strong>{chosen.length ? count(chosen.length,'playlist')+' selected' : 'Nothing selected'}</strong><span>{count(selectedTracks,'song')} · Importing the same ZIP again makes new copies.</span>{bridge && owner && <span>Destination: {account?.account.email}</span>}</div>{phase === 'running' ? <button className="pill" disabled={stopRequested} onClick={() => { stop.current = true; setStopRequested(true); }}><Pause size={16}/>{stopRequested ? 'Pausing…' : 'Pause import'}</button> : <button className="import-primary" disabled={!remaining.length || accountBusy} onClick={() => void run()}>{accountBusy ? 'Checking account…' : !library ? 'Sign in to import' : phase === 'paused' ? 'Resume import' : 'Import selected'}<ArrowRight size={17}/></button>}</div>}
      <div className="import-privacy import-bottom-note"><LockKeyhole size={15}/><p>Your Spotify account stays separate. This is a one-time copy, not an ongoing sync. Imported songs keep their titles and artists; playback matching isn’t connected yet.</p></div>
    </>}
    {authOpen && bridge && account && <AccountDialog bridge={bridge} account={account.account} close={() => setAuthOpen(false)}/>}
  </div>;
}
