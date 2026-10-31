import path from 'node:path';
import { AccountPlaybackStore } from '@fyspoti/accounts';
import { PlaybackGenerationSchema, PlaybackResolveSchema, PlaybackSaveSchema, PlaybackSourceSchema } from '@fyspoti/contracts';
import { trustedSender } from './ipc.mjs';

export async function installPlayback({ app, ipcMain, safeStorage, window, appUrl, accounts, resolveSource }) {
  const store = new AccountPlaybackStore(path.join(app.getPath('userData'), 'accounts', 'queues'), {
    available: () => safeStorage.isAsyncEncryptionAvailable(), encrypt: text => safeStorage.encryptStringAsync(text), decrypt: bytes => safeStorage.decryptStringAsync(Buffer.from(bytes)),
  });
  await store.initialize();
  const pending = new Set(); let generation = -1;
  const unsubscribeAccounts = accounts.subscribe(state => store.setAccount(state.account));
  const unsubscribe = store.subscribe(session => {
    if (generation !== session.generation) { generation = session.generation; for (const abort of pending) abort.abort(); pending.clear(); }
    if (!window.isDestroyed() && window.webContents.getURL() === appUrl) window.webContents.send('playback:session', session);
  });
  const failure = (code, message, retryable = false) => ({ ok: false, error: { code, message, retryable } });
  const routes = {
    session: { call: () => ({ ok: true, value: store.session() }) },
    load: { schema: PlaybackGenerationSchema, call: value => store.load(value) },
    save: { schema: PlaybackSaveSchema, call: value => store.save(value.generation, value.snapshot) },
    resolve: { schema: PlaybackResolveSchema, async call(value) {
      if (!store.valid(value.generation)) return failure('AUTH_REQUIRED', 'The playback session changed.');
      if (!value.track.durationMs || value.track.durationMs > 3600000 || value.track.title.length > 300 || value.track.artist.length > 300) return failure('UNAVAILABLE', 'Full-track playback needs supported recording metadata.', true);
      for (const previous of pending) previous.abort();
      const abort = new AbortController(); pending.add(abort);
      try {
        const source = await resolveSource(value.track, abort.signal);
        if (abort.signal.aborted || !store.valid(value.generation)) return failure('AUTH_REQUIRED', 'The playback session changed.');
        const parsed = PlaybackSourceSchema.safeParse(source);
        if (!parsed.success || (parsed.data.expiresAt && parsed.data.expiresAt <= Date.now())) return failure('UNAVAILABLE', 'The source is unavailable.', true);
        return { ok: true, value: parsed.data };
      } catch { return failure(store.valid(value.generation) ? 'UNAVAILABLE' : 'AUTH_REQUIRED', 'Full-track playback is unavailable.', true); }
      finally { pending.delete(abort); }
    } },
  };
  for (const [name, route] of Object.entries(routes)) ipcMain.handle(`playback:${name}`, async (event, payload) => {
    if (!trustedSender(event, window, appUrl)) return failure('FORBIDDEN', 'Untrusted playback caller.');
    const parsed = route.schema?.safeParse(payload);
    if (route.schema ? !parsed.success : payload !== undefined) return failure('INVALID_ARGUMENT', 'Invalid playback command.');
    try { return await route.call(parsed?.data); } catch { return failure('UNAVAILABLE', 'Playback storage is unavailable.', true); }
  });
  // Account mode never opens legacy stores, starts old jobs, registers file
  // protocols, or broadcasts their metadata. Standalone P2 hosts remain unchanged.
  const legacy = ['jobs', 'artifacts', 'cancel', 'retry', 'remove-artifact', 'artifact-url', 'select-local', 'load-player', 'save-player', 'resolve-stream', 'download-track'];
  for (const name of legacy) ipcMain.handle(`p2:${name}`, () => { throw new Error('Device downloads and legacy playback are unavailable in account mode.'); });
  return { async close() { unsubscribeAccounts(); unsubscribe(); for (const abort of pending) abort.abort(); await store.close(); for (const name of Object.keys(routes)) ipcMain.removeHandler(`playback:${name}`); for (const name of legacy) ipcMain.removeHandler(`p2:${name}`); } };
}
