import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('local email bridge → encrypted player restart → account isolation', async () => {
  test.setTimeout(240000);
  const url = process.env.SUPABASE_URL!; const key = process.env.SUPABASE_PUBLISHABLE_KEY!; const adminKey = process.env.SUPABASE_TEST_ADMIN_KEY!;
  const mailUrl = process.env.FYSPOTI_TEST_MAIL_URL!;
  if (!url?.startsWith('http://127.0.0.1:') || !mailUrl?.startsWith('http://127.0.0.1:') || process.env.SUPABASE_TEST_TARGET !== 'local') throw new Error('Email/Electron tests are local-only.');
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID(); const emails = [`fyspoti-electron-a-${run}@example.test`, `fyspoti-electron-b-${run}@example.test`];
  const root = path.resolve('work/electron-e2e'); await mkdir(root, { recursive: true });
  await mkdir('work/review', { recursive: true });
  const userData = await mkdtemp(path.join(root, 'session-'));
  const messages = new Set<string>(); let application: ElectronApplication | null = null;
  async function launch() {
    const env: NodeJS.ProcessEnv = { ...process.env, FYSPOTI_E2E: '1', FYSPOTI_USER_DATA: userData, FYSPOTI_SUPABASE_URL: url, FYSPOTI_SUPABASE_PUBLISHABLE_KEY: key, FYSPOTI_PYTHON: process.execPath, FYSPOTI_TEST_SOURCE_SCRIPT: path.resolve('tests/fixtures/playback-source.mjs') };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'SUPABASE_TEST_ADMIN_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
    const childEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const app = await _electron.launch({ args: ['.'], env: childEnv, cwd: process.cwd(), timeout: 30000 });
    application = app;
    app.process().stderr?.on('data', bytes => { const line = String(bytes); if (line.includes('Desktop initialization failed')) console.warn(line.trim()); });
    console.log('Desktop process started');
    const page = await app.firstWindow({ timeout: 20000 });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => console.warn('Renderer error:', error.message));
    console.log('Desktop window attached');
    await page.route('https://itunes.apple.com/**', async route => {
      const term=new URL(route.request().url()).searchParams.get('term')||''; const index=Math.max(0,['Guaraldi','End Game','Hailee','Something Bad','James','Ariana','underscores','glaive'].findIndex(text=>term.includes(text)));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ trackId: 1001+index,
        artistId: 2001, collectionId: 3001+index, trackName: index===0?'Fixture Sunrise':index===1?'Fixture Evening':'Fixture Song '+index, artistName: 'Fixture Artist', collectionName: 'Fixture Album '+index, artworkUrl100:'https://is1-ssl.mzstatic.com/fixture/'+index+'/100x100bb.jpg',
        trackTimeMillis: 214000, trackExplicitness: 'notExplicit', previewUrl: 'https://audio-ssl.itunes.apple.com/preview-fixture.wav' }] }) });
    });
    const samples = 8000 * 45; const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    await page.route('https://audio-ssl.itunes.apple.com/**', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
    // The main window may finish loading before Playwright attaches. Reload only
    // after routes are installed so the acceptance run never uses the live catalog.
    await page.waitForURL('**/dist/index.html');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Recently explored' })).toBeVisible();
    await expect(page.locator('main .card')).toHaveCount(8);
    expect(await page.evaluate(async () => { try { await window.p2!.jobs(); return false; } catch { return true; } })).toBe(true);
    console.log('Desktop catalog ready');
    return { app, page };
  }
  async function codeFor(email: string) {
    let code = '';
    await expect.poll(async () => {
      const search = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then(response => response.json()) as { messages: { ID: string }[] };
      const message = search.messages?.[0]; if (!message) return false;
      messages.add(message.ID);
      const body = await fetch(`${mailUrl}/api/v1/message/${message.ID}`).then(response => response.json()) as { Text: string; HTML: string };
      code = (body.Text || body.HTML).match(/\b\d{6}\b/)?.[0] ?? '';
      return code.length === 6;
    }, { timeout: 15000 }).toBe(true);
    return code;
  }
  async function signIn(page:Page,email:string){
    const requested=await page.evaluate(email=>window.desktop!.cloud!.requestEmailCode(email),email);expect(requested.ok).toBe(true);
    const code=await codeFor(email);const verified=await page.evaluate(({email,code})=>window.desktop!.cloud!.verifyEmailCode(email,code),{email,code});expect(verified.ok).toBe(true);
  }
  async function signOut(page:Page){expect((await page.evaluate(()=>window.desktop!.cloud!.signOut())).ok).toBe(true);}
  async function queue(page:Page){return page.evaluate(async()=>{const api=window.desktop!.playback!,session=await api.session();if(!session.ok)throw Error(session.error.message);const snapshot=await api.load(session.value.generation);if(!snapshot.ok)throw Error(snapshot.error.message);return {session:session.value,snapshot:snapshot.value};});}
  async function action(page:Page,value:import('@fyspoti/contracts').LibraryAction){return page.evaluate(async value=>{const result=await window.desktop!.cloud!.run(value);if(!result.ok)throw Error(result.error.message);return result.value;},value);}
  try{
    let launched=await launch();application=launched.app;let page=launched.page;
    const firstSignInAt=Date.now();await signIn(page,emails[0]!);
    const state=await page.evaluate(()=>window.desktop!.cloud!.getState());expect(state.account.persistent).toBe(true);expect(state.library.playlists).toEqual([]);
    await expect.poll(async()=> (await queue(page)).snapshot?.state.queue.length??-1).toBe(0);
    const track=await page.evaluate(()=>{const entries=JSON.parse(localStorage.getItem('fy-catalog-v2')||'[]') as {track:import('@fyspoti/contracts').Track}[];return entries.find(entry=>entry.track.title==='Fixture Sunrise')!.track;});
    await action(page,{type:'like',track,liked:true});
    const playlist=await action(page,{type:'create',title:'Private A playlist'}) as import('@fyspoti/contracts').Playlist;
    expect((await page.evaluate(id=>window.desktop!.cloud!.load(id),playlist.id)).ok).toBe(true);
    await action(page,{type:'append',playlistId:playlist.id,track});await action(page,{type:'append',playlistId:playlist.id,track});
    const prepared=await page.evaluate(id=>window.desktop!.cloud!.prepareQueue(id),playlist.id);if(!prepared.ok)throw Error(prepared.error.message);
    expect(prepared.value.items).toHaveLength(2);expect(prepared.value.items[0]!.id).not.toBe(prepared.value.items[1]!.id);
    const items=prepared.value.items;const scope=(await queue(page)).session;
    const saved=await page.evaluate(async({generation,items})=>window.desktop!.playback!.save(generation,{state:{generation:1,status:'paused',currentItemId:items[0]!.id,queue:items,positionMs:0,durationMs:214000,volume:.4,repeat:'off',shuffle:false},modes:{},upcomingIds:[items[1]!.id]}),{generation:scope.generation,items});expect(saved.ok).toBe(true);
    const profile=await page.evaluate(()=>{const api=window.desktop!.cloud!;return api.getState().then(state=>api.updateDisplayName('Listener A',{mutationId:crypto.randomUUID(),expectedRevision:state.profile!.revision}));});expect(profile.ok).toBe(true);
    const ciphertext=await readFile(path.join(userData,'accounts/session.enc'));expect(ciphertext.toString()).not.toMatch(/access_token|refresh_token/);
    const encrypted=await readFile(path.join(userData,'accounts/queues',state.account.userId+'.enc'));expect(encrypted.toString()).not.toMatch(/Fixture Sunrise|itunes.apple.com/);
    await application.close();application=null;launched=await launch();application=launched.app;page=launched.page;
    await expect(page.locator('footer .current-track')).toContainText('Fixture Sunrise');await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
    expect((await queue(page)).snapshot!.state.queue).toHaveLength(2);
    await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
    await expect.poll(async()=>Object.values((await queue(page)).snapshot!.modes)).toContain('preview');
    const loaded=await page.evaluate(id=>window.desktop!.cloud!.load(id),playlist.id);expect(loaded.ok).toBe(true);
    await action(page,{type:'remove',playlistId:playlist.id,itemId:items[0]!.id});expect((await queue(page)).snapshot!.state.queue).toHaveLength(2);
    const current=await page.evaluate(()=>window.desktop!.cloud!.getState());expect(current.library.items).toHaveLength(1);expect(current.profile!.displayName).toBe('Listener A');
    await signOut(page);await expect(page.locator('footer .current-track')).not.toContainText('Fixture Sunrise');expect(await page.evaluate(()=>navigator.mediaSession.metadata)).toBeNull();
    expect((await queue(page)).snapshot).toBeNull();
    await signIn(page,emails[1]!);await expect.poll(async()=> (await queue(page)).snapshot?.state.queue.length??-1).toBe(0);
    const b=await page.evaluate(()=>window.desktop!.cloud!.getState());expect(b.library.playlists).toEqual([]);expect(b.library.likedTracks).toEqual([]);expect(b.profile!.displayName).toBe('Listener');
    await signOut(page);await expect.poll(()=>Date.now(),{timeout:65000,intervals:[1000]}).toBeGreaterThanOrEqual(firstSignInAt+61000);await signIn(page,emails[0]!);
    await expect(page.locator('footer .current-track')).toContainText('Fixture Sunrise');await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
    await page.screenshot({path:'work/review/pulled-ui.png'});await signOut(page);
  } finally {
    await application?.close();
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users.data.users) if (emails.includes(user.email ?? '')) await admin.auth.admin.deleteUser(user.id);
    if (messages.size) await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...messages] }) });
    const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => { console.warn('Electron test profile remains under the ignored work directory because Windows still holds a file.'); });
  }
});
