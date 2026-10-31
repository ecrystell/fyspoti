import {useRef,useState} from 'react';
import {ImportFormatError,applyImportEntry,parseSpotifyExport,previewSpotifyImport,readSpotifyArchive,type ImportOutcome,type ImportPreview} from '@fyspoti/catalog';
import type {Library} from '@fyspoti/contracts';
import './import.css';
// P1 screen for P4's export importer. Reading and previewing stay on this computer; only a confirmed run writes to P3's cloud library.
type Outcome=ImportOutcome|{status:'failed'};type Props={library:Library|null;onSignIn:()=>void;onImported:()=>void};
const MAX_ARCHIVE=256*1024*1024;
const count=(n:number,word:string)=>n+' '+word+(n===1?'':'s');
const skipText=(s:Record<string,number>)=>Object.entries(s).filter(([,n])=>n).map(([k,n])=>k==='malformed'?n+' unreadable':count(n,k==='local-track'?'local file':k)).join(', ');
function outcomeText(o:Outcome){if(o.status==='failed')return 'Import failed unexpectedly. Nothing further was written.';if(o.status==='complete')return 'Imported '+count(o.imported,'track')+(o.notImported?' · '+o.notImported+' not imported':'');return 'Stopped after '+count(o.imported,'track')+' ('+o.error.code+(o.error.retryable?', temporary':'')+').'+(o.resume?' Resume continues in the same playlist.':' Retrying creates a new playlist.')}
export function SpotifyImport(p:Props){
 const input=useRef<HTMLInputElement>(null);const[reading,Reading]=useState(false),[running,Running]=useState(false),[error,SetError]=useState(''),[preview,SetPreview]=useState<ImportPreview|null>(null),[chosen,Chosen]=useState<number[]>([]),[outcomes,Outcomes]=useState<Record<number,Outcome>>({});
 async function choose(file:File){SetError('');Outcomes({});SetPreview(null);if(file.size>MAX_ARCHIVE){SetError('This file is larger than a Spotify account data export.');return}Reading(true);try{const next=await previewSpotifyImport(parseSpotifyExport(readSpotifyArchive(new Uint8Array(await file.arrayBuffer()))));SetPreview(next);Chosen(next.entries.map((_,i)=>i))}catch(e){SetError(e instanceof ImportFormatError?e.message:'This file could not be read.')}finally{Reading(false)}}
 // Stops at the first interruption: writes are not idempotent yet, so only the user decides to resume.
 async function run(){if(!preview)return;if(!p.library){p.onSignIn();return}Running(true);const done={...outcomes};for(const i of chosen.filter(i=>done[i]?.status!=='complete')){const previous=done[i];const resume=previous?.status==='interrupted'&&previous.resume?previous.resume:undefined;try{done[i]=await applyImportEntry(p.library,preview.entries[i],resume)}catch{done[i]={status:'failed'}}Outcomes({...done});if(done[i].status!=='complete')break}Running(false);p.onImported()}
 const entries=preview?.entries||[],remaining=chosen.filter(i=>outcomes[i]?.status!=='complete'),sum=(f:(e:ImportPreview['entries'][number])=>number)=>entries.reduce((n,e)=>n+f(e),0);
 return <div className="page-body spotify-import"><h1 className="small-heading">Import from Spotify</h1>
 <ol className="import-steps"><li>On Spotify's account privacy page, use <b>Download your data</b> and choose <b>Account data</b>. <button className="link-button" onClick={()=>window.open('https://www.spotify.com/account/privacy/','_blank','noopener,noreferrer')}>Open privacy page</button></li><li>When the email arrives, download the ZIP.</li><li>Choose it here, review the preview, then confirm.</li></ol>
 <div className="notice">The file is read on this computer. Only playlist and library files are opened; account, contact and payment files are never read. Nothing is saved until you confirm.</div>
 <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void choose(f)}}/>
 <button className="pill" disabled={reading||running} onClick={()=>input.current?.click()}>{reading?'Reading export…':preview?'Choose a different file':'Choose ZIP file'}</button>
 {error&&<p role="alert" className="import-error">{error}</p>}
 {preview&&<><div className="import-stats"><div><b>{entries.filter(e=>e.kind==='playlist').length}</b>playlists</div><div><b>{entries.find(e=>e.kind==='liked-songs')?.counts.resolved??0}</b>liked songs</div><div><b>{sum(e=>e.counts.resolved)}</b>tracks ready</div><div><b>{sum(e=>e.counts.duplicates)}</b>duplicates kept</div></div>
 {(preview.notImported.savedAlbums>0||preview.notImported.savedArtists>0)&&<p className="import-muted">Not imported yet: {preview.notImported.savedAlbums} saved albums and {preview.notImported.savedArtists} saved artists. The library has no place for them yet.</p>}
 <p className="import-muted">Each list becomes a new private cloud playlist; importing again makes copies. Tracks are saved by name and will not play until the catalog can match them.</p>
 <ul className="import-entries">{entries.map((e,i)=><li key={i} className="import-entry"><input type="checkbox" aria-label={'Import '+e.title} disabled={running||outcomes[i]?.status==='complete'} checked={chosen.includes(i)} onChange={x=>Chosen(x.target.checked?[...chosen,i].sort((a,b)=>a-b):chosen.filter(n=>n!==i))}/><div><strong>{e.title}</strong><span>{e.kind==='liked-songs'?'Liked Songs':'Playlist'} · {count(e.counts.resolved,'track')}{e.counts.duplicates?' · '+count(e.counts.duplicates,'duplicate')+' kept':''}{skipText(e.skipped)?' · skipped '+skipText(e.skipped):''}</span>{outcomes[i]&&<span role="status" className={'import-outcome '+outcomes[i].status}>{outcomeText(outcomes[i])}</span>}</div></li>)}</ul>
 <div className="import-actions"><button className="save" disabled={running||!remaining.length} onClick={()=>void run()}>{!p.library?'Sign in to import':running?'Importing…':Object.values(outcomes).some(o=>o.status==='interrupted')?'Resume import':'Import '+remaining.length+' to cloud library'}</button></div></>}
 </div>
}
