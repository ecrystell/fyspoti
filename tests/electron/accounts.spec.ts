import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('local email → cloud library → encrypted restart → account isolation', async () => {
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
  async function accountMenu(page: Page) { await page.getByTitle('Account', {exact:true}).click(); }
  async function signIn(page: Page, email: string) {
    console.log('Opening P1 account menu');
    await accountMenu(page); await page.getByRole('button',{name:'Sign in to cloud library',exact:true}).click();
    console.log('P1 email dialog opened');
    const dialog=page.getByRole('dialog',{name:'Sign in to Fyspoti'});
    await dialog.getByLabel('Email address').fill(email); await dialog.getByRole('button',{name:'Send email code'}).click();
    await expect(dialog.getByLabel('Email code')).toBeVisible(); await dialog.getByLabel('Email code').fill(await codeFor(email));
    console.log('Local email code received');
    await dialog.getByRole('button',{name:'Verify code'}).click();
    await expect.poll(async()=> (await page.evaluate(()=>window.desktop!.cloud!.getState())).account.phase).toBe('authenticated');
    await expect(dialog).toHaveCount(0);
  }
  async function signOut(page: Page) {
    await accountMenu(page); await page.getByRole('button',{name:/^Cloud library:/}).click();
    await page.getByRole('dialog',{name:'cloud',exact:true}).getByRole('button',{name:'Sign out',exact:true}).click();
    await expect.poll(async()=> (await page.evaluate(()=>window.desktop!.cloud!.getState())).account.userId).toBeNull();
  }
  async function search(page: Page) { await page.getByTitle('Browse',{exact:true}).click(); }
  function song(page: Page,title='Fixture Sunrise'){return page.locator('main .tr:not(.th)').filter({hasText:title});}
  async function selectPlaylist(page: Page,title='Private A playlist'){await page.locator('.library-scroll .library-item').filter({hasText:title}).click();}
  async function createPlaylist(page:Page,title:string){
    await page.getByRole('button',{name:'Create playlist',exact:true}).click();
    await expect(page.getByRole('heading',{name:/^My Playlist #/})).toBeVisible();
    await page.getByRole('button',{name:'Name & details',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'playlist',exact:true});await dialog.getByLabel('Name',{exact:true}).fill(title);
    await dialog.getByRole('button',{name:'Save',exact:true}).click(); await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  }
  async function addTo(page:Page,title:string){
    await page.getByRole('menuitem',{name:'Add to playlist',exact:true}).click();
    await page.getByRole('menu',{name:'Add to playlist',exact:true}).getByTitle(title,{exact:true}).click();
    await expect(page.getByRole('menu',{name:'track',exact:true})).toHaveCount(0);
  }
  async function queueLength(page:Page){return page.evaluate(async()=>{const api=window.desktop!.playback!;const scope=await api.session();if(!scope.ok)return -1;const saved=await api.load(scope.value.generation);return saved.ok?saved.value?.state.queue.length:-1;});}
  try {
    let launched=await launch();application=launched.app;let page=launched.page;
    await page.evaluate(()=>{localStorage.setItem('fy-lists',JSON.stringify([{id:'prototype-private',name:'Do not upload',tracks:[0]}]));localStorage.setItem('fy-liked','[0]');});
    await page.screenshot({path:'work/review/p1-home.png'});
    const firstSignInAt=Date.now();await signIn(page,emails[0]!);
    await expect(page.getByText('Do not upload')).toHaveCount(0);
    const state=await page.evaluate(()=>window.desktop!.cloud!.getState());expect(state.account.persistent).toBe(true);expect(state.library.playlists).toEqual([]);
    await search(page);await song(page).getByRole('button',{name:'Save song',exact:true}).click();
    await expect(song(page).locator('svg.lucide-check')).toBeVisible();
    await createPlaylist(page,'Private A playlist');
    for(let index=0;index<2;index++){await search(page);await song(page).getByRole('button',{name:'Track actions',exact:true}).click();await addTo(page,'Private A playlist');}
    await selectPlaylist(page);await expect(page.locator('[data-item-id]')).toHaveCount(2);
    await page.locator('[data-item-id]').first().getByTitle('Play track',{exact:true}).click();
    await expect(page.locator('footer [data-playback-mode]')).toHaveText('Preview');
    await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
    expect(await queueLength(page)).toBe(2);
    await createPlaylist(page,'Second destination');await selectPlaylist(page);await expect(page.locator('[data-item-id]')).toHaveCount(2);
    await page.locator('[data-item-id]').first().getByRole('button',{name:'Track actions',exact:true}).click();await addTo(page,'Second destination');
    expect(await page.evaluate(async()=>{const api=window.desktop!.cloud!,state=await api.getState(),id=state.library.playlists.find(p=>p.title==='Second destination')!.id;const result=await api.prepareQueue(id);return result.ok?result.value.items.length:-1;})).toBe(1);
    await page.locator('[data-item-id]').first().getByRole('button',{name:'Track actions',exact:true}).click();
    await page.getByRole('menuitem',{name:'Remove from this playlist',exact:true}).click();await expect(page.locator('[data-item-id]')).toHaveCount(1);expect(await queueLength(page)).toBe(2);
    await accountMenu(page);await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('button',{name:'Edit profile',exact:true}).click();
    const profile=page.getByRole('dialog',{name:'profile',exact:true});await profile.getByLabel('Name',{exact:true}).fill('Listener A');await profile.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Listener A',exact:true})).toBeVisible();
    expect((await readFile(path.join(userData,'accounts/session.enc'))).toString()).not.toMatch(/access_token|refresh_token/);
    const queue=await readFile(path.join(userData,'accounts/queues',state.account.userId+'.enc'));expect(queue.toString()).not.toMatch(/Fixture Sunrise|itunes.apple.com/);
    await application.close();application=null;launched=await launch();application=launched.app;page=launched.page;
    await expect(page.locator('footer .current-track')).toContainText('Fixture Sunrise');await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveCount(0);await selectPlaylist(page);await expect(page.locator('[data-item-id]')).toHaveCount(1);
    expect(await page.evaluate(()=>localStorage.getItem('fy-lists'))).toContain('Do not upload');
    await signOut(page);await expect(page.locator('footer .current-track')).not.toContainText('Fixture Sunrise');expect(await page.evaluate(()=>navigator.mediaSession.metadata)).toBeNull();
    await search(page);await song(page,'Fixture Evening').getByTitle('Play track',{exact:true}).click();
    await expect(page.locator('footer [data-playback-mode]')).toHaveText('Full track');await page.getByRole('button',{name:'Pause',exact:true}).click();
    await signIn(page,emails[1]!);await expect(page.locator('footer .current-track')).toContainText('Choose a song');
    const otherState=await page.evaluate(()=>window.desktop!.cloud!.getState());expect(otherState.profile?.displayName).toBe('Listener');expect(otherState.library.playlists).toEqual([]);expect(otherState.library.likedTracks).toEqual([]);
    await page.screenshot({path:'work/review/p1-empty-account.png'});await signOut(page);
    await expect.poll(()=>Date.now(),{timeout:65000,intervals:[1000]}).toBeGreaterThanOrEqual(firstSignInAt+61000);await signIn(page,emails[0]!);
    await expect(page.locator('footer .current-track')).toContainText('Fixture Sunrise');
    await page.getByRole('separator',{name:'Resize library',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await selectPlaylist(page);await page.getByRole('button',{name:'Name & details',exact:true}).click();const rename=page.getByRole('dialog',{name:'playlist',exact:true});
    await rename.getByLabel('Name',{exact:true}).fill('A long private playlist title in the original P1 interface');await page.keyboard.press('Tab');expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await rename.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('heading',{name:'A long private playlist title in the original P1 interface',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Search in Your Library',exact:true}).click();await page.getByLabel('Search library',{exact:true}).fill('no match');await expect(page.locator('.library-scroll .library-item').filter({hasText:'A long private'})).toHaveCount(0);await page.getByLabel('Search library',{exact:true}).fill('');
    await page.screenshot({path:'work/review/p1-playlist.png'});await page.setViewportSize({width:1050,height:760});await page.screenshot({path:'work/review/p1-narrow.png'});await signOut(page);
  } finally {
    await application?.close();
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users.data.users) if (emails.includes(user.email ?? '')) await admin.auth.admin.deleteUser(user.id);
    if (messages.size) await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...messages] }) });
    const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => { console.warn('Electron test profile remains under the ignored work directory because Windows still holds a file.'); });
  }
});
