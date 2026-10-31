import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronRight,Plus,Search} from 'lucide-react';
import './context-menu.css';
// Context-menu submenus. Structure and strings follow the Spotify desktop package; geometry follows its submenu rule
// (250px minimum width, at most 50vh tall, scrolling). Evidence and limits: docs/23-context-menus.md.
type SubmenuProps={label:string;children:ReactNode};
export function SubmenuItem(p:SubmenuProps){
 const[open,Open]=useState(false),[point,Point]=useState<{left:number;top:number}|null>(null);
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),closeTimer=useRef<ReturnType<typeof setTimeout>>(undefined),focusOnOpen=useRef(false);
 function show(focus:boolean){clearTimeout(closeTimer.current);focusOnOpen.current=focus;Open(true)}
 function hide(returnFocus=false){clearTimeout(closeTimer.current);Open(false);Point(null);if(returnFocus)trigger.current?.focus()}
 // Opens beside the trigger, flipping left or upwards when the viewport has no room.
 useLayoutEffect(()=>{if(!open||!trigger.current||!panel.current)return;const t=trigger.current.getBoundingClientRect(),w=panel.current.offsetWidth,h=panel.current.offsetHeight;Point({left:t.right+w+8<=innerWidth?t.right+4:Math.max(8,t.left-w-4),top:Math.max(8,Math.min(t.top-8,innerHeight-h-12))})},[open]);
 // Focus only once placed: the panel is visibility:hidden while being measured and cannot take focus then.
 useEffect(()=>{if(point&&focusOnOpen.current){focusOnOpen.current=false;panel.current?.querySelector<HTMLElement>('input,button')?.focus()}},[point]);
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 function keys(e:React.KeyboardEvent){e.stopPropagation();const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('input,button')||[]),i=items.indexOf(document.activeElement as HTMLElement),typing=(document.activeElement as HTMLElement)?.tagName==='INPUT';
  if(e.key==='Escape'||(e.key==='ArrowLeft'&&!typing)){e.preventDefault();hide(true)}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
  else if((e.key==='Home'||e.key==='End')&&!typing){e.preventDefault();(e.key==='Home'?items[0]:items.at(-1))?.focus()}}
 return <div className="submenu-host" onMouseEnter={()=>show(false)} onMouseLeave={()=>{closeTimer.current=setTimeout(()=>hide(),150)}}>
  <button ref={trigger} role="menuitem" aria-haspopup="menu" aria-expanded={open} className="submenu-trigger" data-context-menu-open={open||undefined} onClick={()=>open?hide():show(true)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();show(true)}}}>{p.label}<ChevronRight size={16} aria-hidden/></button>
  {/* Portalled: the parent menu scrolls and animates a transform, which would clip a fixed child. */}
  {open&&createPortal(<div ref={panel} className="submenu" role="menu" aria-label={p.label} style={point??{visibility:'hidden'}} onKeyDown={keys} onMouseEnter={()=>clearTimeout(closeTimer.current)} onMouseLeave={()=>{closeTimer.current=setTimeout(()=>hide(),150)}}>{p.children}</div>,document.body)}
 </div>
}
export type MenuPlaylist={id:string;name:string;cloud?:boolean};
type AddProps={label?:string;playlists:MenuPlaylist[];onAdd:(p:MenuPlaylist)=>void;onCreate:()=>void};
// Filter row, New playlist, divider, then the matching playlists — not every playlist inline in the parent menu.
export function AddToPlaylistItem(p:AddProps){
 const[filter,Filter]=useState(''),needle=filter.trim().toLowerCase(),matches=p.playlists.filter(x=>x.name.toLowerCase().includes(needle));
 return <SubmenuItem label={p.label??'Add to playlist'}>
  <label className="submenu-filter"><Search size={16} aria-hidden/><input value={filter} onChange={e=>Filter(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist"/></label>
  <button role="menuitem" onClick={p.onCreate}><Plus size={16} aria-hidden/>New playlist</button>
  <div className="submenu-divider" role="separator"/>
  <div className="submenu-list">{matches.map(x=><button key={x.id} role="menuitem" title={x.name} onClick={()=>p.onAdd(x)}><span>{x.name}</span>{x.cloud&&<small>Cloud</small>}</button>)}
  {!matches.length&&<p className="submenu-empty">{needle?'No results found for "'+filter.trim()+'"':'No playlists yet'}</p>}</div>
 </SubmenuItem>
}
