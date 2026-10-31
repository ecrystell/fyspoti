import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('local email → cloud library → encrypted restart → account isolation', async () => {
  const url = process.env.SUPABASE_URL!; const key = process.env.SUPABASE_PUBLISHABLE_KEY!; const adminKey = process.env.SUPABASE_TEST_ADMIN_KEY!;
  const mailUrl = process.env.FYSPOTI_TEST_MAIL_URL!;
  if (!url?.startsWith('http://127.0.0.1:') || !mailUrl?.startsWith('http://127.0.0.1:') || process.env.SUPABASE_TEST_TARGET !== 'local') throw new Error('Email/Electron tests are local-only.');
  const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID(); const emails = [`fyspoti-electron-a-${run}@example.test`, `fyspoti-electron-b-${run}@example.test`];
  const root = path.resolve('work/electron-e2e'); await mkdir(root, { recursive: true });
  const userData = await mkdtemp(path.join(root, 'session-'));
  const messages = new Set<string>(); let application: ElectronApplication | null = null;
  async function launch() {
    const env: NodeJS.ProcessEnv = { ...process.env, FYSPOTI_E2E: '1', FYSPOTI_USER_DATA: userData, FYSPOTI_SUPABASE_URL: url, FYSPOTI_SUPABASE_PUBLISHABLE_KEY: key };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'SUPABASE_TEST_ADMIN_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
    const childEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const app = await _electron.launch({ args: ['.'], env: childEnv, cwd: process.cwd(), timeout: 30000 });
    application = app;
    app.process().stderr?.on('data', bytes => { const line = String(bytes); if (line.includes('Desktop initialization failed')) console.warn(line.trim()); });
    console.log('Desktop process started');
    const page = await app.firstWindow({ timeout: 20000 });
    page.on('pageerror', error => console.warn('Renderer error:', error.message));
    console.log('Desktop window attached');
    await page.route('https://itunes.apple.com/**', async route => {
      const first = route.request().url().includes('Guaraldi');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ trackId: first ? 1001 : 1002,
        artistId: 2001, collectionId: 3001, trackName: first ? 'Fixture Sunrise' : 'Fixture Evening', artistName: 'Fixture Artist', collectionName: 'Fixture Album',
        trackTimeMillis: 214000, trackExplicitness: 'notExplicit' }] }) });
    });
    // The main window may finish loading before Playwright attaches. Reload only
    // after routes are installed so the acceptance run never uses the live catalog.
    await page.waitForURL('**/dist/index.html');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Music for you' })).toBeVisible();
    expect(await page.evaluate(async () => ({ bridge: typeof window.p2, jobs: Array.isArray(await window.p2!.jobs()) }))).toEqual({ bridge: 'object', jobs: true });
    await expect(page.getByRole('button', { name: 'Like Fixture Sunrise', exact: true }).or(page.getByRole('button', { name: 'Unlike Fixture Sunrise', exact: true }))).toBeVisible();
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
  async function signIn(page: Page, email: string) {
    console.log('Starting local email sign-in');
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Sign in to Fyspoti' });
    await dialog.getByLabel('Email address').fill(email);
    await dialog.getByRole('button', { name: 'Send email code' }).click();
    await expect(dialog.getByLabel('Email code')).toBeVisible();
    const code = await codeFor(email);
    await dialog.getByLabel('Email code').fill(code);
    await dialog.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByText('Loading your library…')).toHaveCount(0);
    console.log('Local email sign-in complete');
  }
  try {
    let launched = await launch(); application = launched.app; let page = launched.page;
    // Prototype data exists but must neither appear in desktop cloud mode nor upload.
    await page.evaluate(() => { localStorage.setItem('fy-lists', JSON.stringify([{ id: 'prototype-private', name: 'Do not upload', tracks: [0] }])); localStorage.setItem('fy-liked', '[0]'); });
    await signIn(page, emails[0]!);
    await expect(page.getByText('Do not upload')).toHaveCount(0);
    await expect(page.getByText('No playlists yet. Create your first playlist above.')).toBeVisible();
    const state = await page.evaluate(() => window.desktop!.cloud!.getState());
    expect(state.account.persistent).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/access_token|refresh_token/);
    await expect(page.getByRole('button', { name: 'Like Fixture Sunrise', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Like Fixture Sunrise', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlike Fixture Sunrise', exact: true })).toBeVisible();
    console.log('Cloud like saved');
    await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Create playlist', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Private A playlist'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Private A playlist', exact: true })).toBeVisible();
    console.log('Private playlist created');
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: 'Actions for Fixture Sunrise', exact: true }).click();
      await page.getByRole('dialog', { name: 'Track actions' }).getByRole('button', { name: 'Add to Private A playlist' }).click();
      await expect(page.getByRole('dialog', { name: 'Track actions' })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Private A playlist Private playlist', exact: true }).click();
    await expect(page.locator('[data-item-id]')).toHaveCount(2);
    await page.locator('[data-item-id]').first().getByRole('button', { name: 'Actions for Fixture Sunrise' }).click();
    await page.getByRole('button', { name: 'Remove this item', exact: true }).click();
    await expect(page.locator('[data-item-id]')).toHaveCount(1);
    console.log('Duplicate item removal verified');
    await page.getByRole('button', { name: 'Your profile', exact: true }).click();
    await page.getByRole('button', { name: 'Edit display name' }).click(); dialog = page.getByRole('dialog', { name: 'Edit profile' });
    await dialog.getByLabel('Name', { exact: true }).fill('Listener A'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Listener A', exact: true })).toBeVisible();
    console.log('Profile saved; restarting desktop');
    const ciphertext = await readFile(path.join(userData, 'accounts/session.enc'));
    expect(ciphertext.toString()).not.toContain('access_token'); expect(ciphertext.toString()).not.toContain('refresh_token');
    await application.close(); application = null;
    launched = await launch(); application = launched.app; page = launched.page;
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Private A playlist Private playlist', exact: true }).click();
    await expect(page.locator('[data-item-id]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('fy-lists'))).toContain('Do not upload');
    await page.screenshot({ path: 'work/electron-results/cloud-library.png' });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Private A playlist Private playlist', exact: true })).toHaveCount(0);
    await signIn(page, emails[1]!);
    await expect(page.getByRole('button', { name: 'Private A playlist Private playlist', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Like Fixture Sunrise', exact: true })).toBeVisible();
    const otherState = await page.evaluate(() => window.desktop!.cloud!.getState());
    expect(otherState.profile?.displayName).toBe('Listener'); expect(otherState.library.playlists).toEqual([]); expect(otherState.library.likedTracks).toEqual([]);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  } finally {
    await application?.close();
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const user of users.data.users) if (emails.includes(user.email ?? '')) await admin.auth.admin.deleteUser(user.id);
    if (messages.size) await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...messages] }) });
    const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => { console.warn('Electron test profile remains under the ignored work directory because Windows still holds a file.'); });
  }
});
