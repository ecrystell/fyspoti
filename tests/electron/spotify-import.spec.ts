import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('Spotify ZIP UI to local email to imported library', async () => {
  test.setTimeout(240000);
  const url = process.env.SUPABASE_URL!; const key = process.env.SUPABASE_PUBLISHABLE_KEY!; const adminKey = process.env.SUPABASE_TEST_ADMIN_KEY!;
  const mailUrl = process.env.FYSPOTI_TEST_MAIL_URL!;
  if (!url?.startsWith('http://127.0.0.1:') || !mailUrl?.startsWith('http://127.0.0.1:') || process.env.SUPABASE_TEST_TARGET !== 'local') throw new Error('Email/Electron tests are local-only.');
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID(); const emails = [`fyspoti-import-a-${run}@example.test`, `fyspoti-import-b-${run}@example.test`];
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
  try {
    const launched = await launch(); application = launched.app; const page = launched.page;
    await page.getByRole('button', { name: 'App menu', exact: true }).click();
    await page.getByRole('button', { name: 'Import from Spotify', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import from Spotify' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass('synthwave');
    await page.screenshot({ path: 'work/review/spotify-import-empty.png' });
    const file = page.getByLabel('Spotify export ZIP');
    await file.setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
    await expect(page.getByRole('alert')).toBeVisible();
    const uri = (letter: string) => 'spotify:track:' + letter.padEnd(22, '0');
    const item = (name: string, letter: string) => ({ track: { trackName: name, artistName: 'Fixture Artist', albumName: 'Fixture Album', trackUri: uri(letter) }, episode: null, audiobook: null, localTrack: null });
    const archive = Buffer.from(zipSync({
      'Spotify Account Data/Playlist1.json': strToU8(JSON.stringify({ playlists: [
        { name: 'Neon night drive', items: [item('First light', 'a'), item('After hours', 'b'), item('First light', 'a')] },
        { name: 'Leave this behind', items: [item('Unselected song', 'c')] }
      ] })),
      'YourLibrary.json': strToU8(JSON.stringify({ tracks: [{ track: 'Saved favorite', artist: 'Fixture Artist', album: 'Fixture Album', uri: uri('d') }], albums: [{ album: 'Saved album', artist: 'Fixture Artist' }], artists: [{ name: 'Saved artist' }] })),
      'Userdata.json': strToU8(JSON.stringify({ email: 'PRIVATE-IGNORED@example.test' }))
    }));
    await file.setInputFiles({ name: 'spotify-account-data.zip', mimeType: 'application/zip', buffer: archive });
    await expect(page.getByRole('heading', { name: 'Choose what to import' })).toBeVisible();
    await expect(page.getByText('Saved as a private playlist', { exact: false })).toBeVisible();
    await expect(page.getByText('1 saved album, 1 saved artist', { exact: false })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('PRIVATE-IGNORED');
    await page.getByRole('checkbox', { name: 'Import Leave this behind', exact: true }).uncheck();
    await page.locator('.import-entry').filter({ hasText: 'Neon night drive' }).getByText('Preview songs', { exact: true }).click();
    await expect(page.getByText('After hours', { exact: true })).toBeVisible();
    await page.locator('main').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: 'work/review/spotify-import-review.png' });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 850));
    expect(await page.locator('.spotify-import').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'work/review/spotify-import-narrow.png' });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 940));
    await page.getByRole('button', { name: 'Sign in to import', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(emails[0]!);
    await page.getByRole('button', { name: 'Send email code', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email code', exact: true }).fill(await codeFor(emails[0]!));
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await page.evaluate(() => window.desktop!.cloud!.getState()); const owner = state.account.userId!;
    const before = await page.evaluate(expectedAccountId => window.desktop!.cloud!.importLibrary({ operation: 'playlists', expectedAccountId }), owner);
    expect(before).toEqual({ ok: true, value: { items: [], nextCursor: null } });
    await page.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your music is here' })).toBeVisible();
    await expect(page.locator('.import-result')).toContainText('2 playlists imported with 4 songs');
    const imported = await page.evaluate(async expectedAccountId => {
      const bridge = window.desktop!.cloud!;
      const lists = await bridge.importLibrary({ operation: 'playlists', expectedAccountId }); if (!lists.ok || !('items' in lists.value)) throw Error('No playlists');
      const playlist = lists.value.items.find(p => 'title' in p && p.title === 'Neon night drive')!;
      const items = await bridge.importLibrary({ operation: 'items', expectedAccountId, playlistId: playlist.id });
      return { lists, items, playlist };
    }, owner);
    expect(imported.lists.ok && 'items' in imported.lists.value && imported.lists.value.items).toHaveLength(2);
    if (!imported.items.ok || !('items' in imported.items.value)) throw Error('No items');
    const rows = imported.items.value.items as import('@fyspoti/contracts').PlaylistItem[];
    expect(rows.map(row => row.metadataSnapshot.title)).toEqual(['First light', 'After hours', 'First light']);
    expect(new Set(rows.map(row => row.id)).size).toBe(3); expect(rows[0]!.trackId).toBe(rows[2]!.trackId);
    await page.screenshot({ path: 'work/review/spotify-import-complete.png' });
    await page.locator('.import-entry').filter({ hasText: 'Neon night drive' }).getByRole('button', { name: 'Open playlist' }).click();
    await expect(page.getByRole('heading', { name: 'Neon night drive', exact: true })).toBeVisible();
    await expect(page.locator('main')).toContainText('After hours');
    await page.getByRole('button', { name: 'App menu', exact: true }).click();
    await page.getByRole('button', { name: 'Import from Spotify', exact: true }).click();
    const longArchive = Buffer.from(zipSync({ 'Playlist1.json': strToU8(JSON.stringify({ playlists: [{ name: 'Pause and resume', items: Array.from({ length: 25 }, (_, i) => item('Long song ' + i, String(i))) }] })) }));
    await page.getByLabel('Spotify export ZIP').setInputFiles({ name: 'resume.zip', mimeType: 'application/zip', buffer: longArchive });
    await page.getByRole('button', { name: 'Import selected', exact: true }).click();
    await page.getByRole('button', { name: 'Pause import', exact: true }).click();
    await expect(page.getByText('Import paused', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'work/review/spotify-import-paused.png' });
    await page.getByRole('button', { name: 'Resume import', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your music is here' })).toBeVisible();
    await expect(page.locator('.import-result')).toContainText('1 playlist imported with 25 songs');
    const resumed = await page.evaluate(async expectedAccountId => {
      const lists = await window.desktop!.cloud!.importLibrary({ operation: 'playlists', expectedAccountId });
      if (!lists.ok || !('items' in lists.value)) throw Error('Missing playlists');
      const matching = lists.value.items.filter(p => 'title' in p && p.title === 'Pause and resume');
      const result = await window.desktop!.cloud!.importLibrary({ operation: 'items', expectedAccountId, playlistId: matching[0]!.id });
      return { count: matching.length, result };
    }, owner);
    expect(resumed.count).toBe(1); expect(resumed.result.ok && 'items' in resumed.result.value && resumed.result.value.items).toHaveLength(25);
    expect((await page.evaluate(() => window.desktop!.cloud!.signOut())).ok).toBe(true);
    await expect(page.locator('main')).not.toContainText('After hours');
    const stale = await page.evaluate(expectedAccountId => window.desktop!.cloud!.importLibrary({ operation: 'create', expectedAccountId, title: 'Must not be created' }), owner);
    expect(stale.ok).toBe(false);
  } finally {
    await application?.close();
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users.data.users) if (emails.includes(user.email ?? '')) await admin.auth.admin.deleteUser(user.id);
    if (messages.size) await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...messages] }) });
    const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
