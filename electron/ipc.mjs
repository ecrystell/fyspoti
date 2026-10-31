import { DesktopSchemas } from '@fyspoti/contracts';

export function trustedSender(event, window, appUrl) {
  return !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === appUrl;
}
export function installAccountHandlers(ipcMain, window, service, appUrl) {
  const invalid = { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid desktop command.', retryable: false } };
  const routes = {
    'state': { call: () => service.snapshot() },
    'request-code': { schema: DesktopSchemas.email, call: value => service.requestEmailCode(value) },
    'verify-code': { schema: DesktopSchemas.verify, call: value => service.verifyEmailCode(value.email, value.code) },
    'cancel-code': { call: () => service.cancelEmailCode() },
    'restore': { call: () => service.restore() },
    'sign-out': { call: () => service.signOut() },
    'profile': { schema: DesktopSchemas.profile, call: value => service.updateDisplayName(value.displayName, value.context) },
    'load': { schema: DesktopSchemas.playlistId, call: value => service.load(value) },
    'load-more': { schema: DesktopSchemas.pageKind, call: value => service.loadMore(value) },
    'action': { schema: DesktopSchemas.action, call: value => service.run(value) },
    'retry-conflict': { call: () => service.retryConflict() },
    'retry-uncertain': { call: () => service.retryUncertain() },
    'prepare-queue': { schema: DesktopSchemas.requiredId, call: value => service.prepareQueue(value) },
    'prepare-liked-queue': { call: () => service.prepareLikedQueue() },
    'import-library': { schema: DesktopSchemas.importLibrary, call: value => service.importLibrary(value) },
    'get-like': { schema: DesktopSchemas.trackId, call: value => service.getTrackLike(value) },
  };
  for (const [name, route] of Object.entries(routes)) {
    ipcMain.handle(`fyspoti:${name}`, async (event, payload) => {
      if (!trustedSender(event, window, appUrl)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted desktop caller.', retryable: false } };
      const value = route.schema?.safeParse(payload);
      if (route.schema ? !value.success : payload !== undefined) return invalid;
      try { return await route.call(value?.data); }
      catch { return { ok: false, error: { code: 'UNAVAILABLE', message: 'Desktop account operation failed. Please retry.', retryable: true } }; }
    });
  }
  const unsubscribe = service.subscribe(state => {
    if (!window.isDestroyed() && window.webContents.getURL() === appUrl) window.webContents.send('fyspoti:state', state);
  });
  return () => { unsubscribe(); for (const name of Object.keys(routes)) ipcMain.removeHandler(`fyspoti:${name}`); };
}
