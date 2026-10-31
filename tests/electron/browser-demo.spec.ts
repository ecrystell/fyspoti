import { _electron, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('browser demo stays independent of desktop accounts and services', async () => {
  const dist = path.resolve('dist');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://127.0.0.1').pathname);
      const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(dist + path.sep)) throw new Error('Invalid fixture request');
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server failed');
  const root = path.resolve('work/browser-e2e'); await mkdir(root, { recursive: true });
  const userData = await mkdtemp(path.join(root, 'session-'));
  const env = Object.fromEntries(Object.entries({ ...process.env, FYSPOTI_USER_DATA: userData, FYSPOTI_DEMO_TEST_URL: `http://127.0.0.1:${address.port}` }).filter((entry): entry is [string, string] => entry[1] !== undefined && !['ELECTRON_RUN_AS_NODE', 'SUPABASE_TEST_ADMIN_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'].includes(entry[0])));
  const app = await _electron.launch({ args: ['tests/fixtures/browser-host.cjs'], env });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://itunes.apple.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ trackId: 1001, artistId: 2001, collectionId: 3001, trackName: 'Browser Fixture Song', artistName: 'Fixture Artist', collectionName: 'Fixture Album', artworkUrl100: 'https://is1-ssl.mzstatic.com/fixture/100x100bb.jpg', trackTimeMillis: 214000 }] }) }));
    await page.waitForURL(`http://127.0.0.1:${address.port}/`); await page.reload();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('Fixture Album', { exact: true }).first()).toBeVisible();
    await page.locator('main .card .cover').first().click();
    await expect(page.getByText('Browser Fixture Song', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => ({ desktop: typeof window.desktop, p2: typeof window.p2 }))).toEqual({ desktop: 'undefined', p2: 'undefined' });
    expect(await page.evaluate(() => localStorage.getItem('fy-lists'))).not.toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test profile');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
