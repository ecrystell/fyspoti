import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
  const command = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
  const status = JSON.parse(execFileSync(command, ['status', '--workdir', 'services/cloud', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const env = { ...process.env, FYSPOTI_SUPABASE_URL: status.API_URL, FYSPOTI_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SUPABASE_TEST_ADMIN_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
  const child = spawn(require('electron'), ['.'], { env, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Start local Supabase with its mail catcher, apply migrations, and run npm run setup:desktop first.'); process.exitCode = 1;
}
