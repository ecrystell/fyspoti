import { execFileSync, spawnSync } from 'node:child_process';

// Read local CLI credentials into the child process only. Never print or persist them.
try {
  const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
  const output = execFileSync(command, ['status', '--workdir', 'services/cloud', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const status = JSON.parse(output);
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_TEST_TARGET: 'local',
      SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
      SUPABASE_TEST_ADMIN_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch {
  console.error('Local integration could not start. Start Docker, run npm run cloud:start and npm run cloud:reset, then retry.');
  process.exitCode = 1;
}
