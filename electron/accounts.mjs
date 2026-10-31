import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { AccountService, SessionVault } from '@fyspoti/accounts';
import { installAccountHandlers } from './ipc.mjs';

export async function installAccounts({ app, ipcMain, safeStorage, window, appUrl }) {
  let file = {};
  try { file = parseEnv(await readFile(path.join(app.getAppPath(), '.env.desktop'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = process.env.FYSPOTI_SUPABASE_URL ?? file.FYSPOTI_SUPABASE_URL;
  const publishableKey = process.env.FYSPOTI_SUPABASE_PUBLISHABLE_KEY ?? file.FYSPOTI_SUPABASE_PUBLISHABLE_KEY;
  const vault = new SessionVault(path.join(app.getPath('userData'), 'accounts', 'session.enc'), {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: text => safeStorage.encryptStringAsync(text),
    decrypt: bytes => safeStorage.decryptStringAsync(Buffer.from(bytes)),
  });
  // Default desktop development connects only to the local Supabase stack.
  // No admin/fixture variables or .env.cloud file are read by the application.
  const service = new AccountService({ url: url ?? 'http://127.0.0.1:54321', publishableKey: publishableKey ?? 'missing-local-publishable-key', vault });
  const dispose = installAccountHandlers(ipcMain, window, service, appUrl);
  await service.initialize();
  return { service, async close() { dispose(); await service.close(); } };
}
