import { execFileSync, spawnSync } from 'node:child_process';
try {
  const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
  const status = JSON.parse(execFileSync(command, ['status', '--workdir', 'services/cloud', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!status.API_URL?.startsWith('http://127.0.0.1:') || !status.MAILPIT_URL) throw new Error('Local services missing');
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.config.ts'], {
    stdio: 'inherit', env: { ...process.env, SUPABASE_TEST_TARGET: 'local', SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY, SUPABASE_TEST_ADMIN_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY, FYSPOTI_TEST_MAIL_URL: status.MAILPIT_URL },
  });
  process.exitCode = result.status ?? 1;
} catch { console.error('Electron checks require local Supabase, Mailpit and the pinned Electron runtime.'); process.exitCode = 1; }
