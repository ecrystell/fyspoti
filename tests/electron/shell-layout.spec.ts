import { _electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

test('P1 narrow desktop layout opens its original library search', async () => {
  const root = path.resolve('work/layout-e2e'); await mkdir(root, { recursive: true });
  const userData = await mkdtemp(path.join(root, 'session-'));
  const env = Object.fromEntries(Object.entries({ ...process.env, FYSPOTI_E2E: '1', FYSPOTI_USER_DATA: userData,
    FYSPOTI_SUPABASE_URL: process.env.SUPABASE_URL, FYSPOTI_SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined && !['ELECTRON_RUN_AS_NODE', 'SUPABASE_TEST_ADMIN_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'].includes(entry[0])));
  const app = await _electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await page.route('https://itunes.apple.com/**', route => route.fulfill({ contentType: 'application/json', body: '{"results":[]}' }));
    await page.waitForURL('**/dist/index.html'); await page.reload();
    await expect(page.getByRole('heading', { name: 'Recently explored' })).toBeVisible();
    await page.setViewportSize({ width: 1050, height: 760 });
    await page.getByRole('button', {name:'Search in Your Library',exact:true}).click();
    const search = page.getByLabel('Search library', { exact: true });
    await expect(search).toHaveCSS('opacity', '1'); await expect(search).toHaveCSS('pointer-events', 'auto');
    await search.click(); await search.fill('Visible keyboard search');
    await mkdir('work/review', { recursive: true }); await page.screenshot({ path: 'work/review/narrow-guest.png' });
  } finally {
    await app.close(); const target = path.resolve(userData); if (!target.startsWith(root + path.sep)) throw new Error('Unexpected test profile');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
