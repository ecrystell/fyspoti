import { describe, expect, it, vi } from 'vitest';
const modulePath = '../../electron/ipc.mjs';
const { installAccountHandlers } = await import(modulePath);

describe('desktop IPC boundary', () => {
  it('accepts only the owning main frame and validates commands before calling services', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const frame = { url: 'file:///test/index.html' };
    const window = { isDestroyed: () => false, webContents: { mainFrame: frame, getURL: () => frame.url, send: vi.fn() } };
    const service = { requestEmailCode: vi.fn(async () => ({ ok: true })), signOut: vi.fn(), subscribe: () => () => {}, snapshot: () => ({ version: 1 }) };
    const dispose = installAccountHandlers({ handle: (name: string, callback: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, callback), removeHandler: (name: string) => handlers.delete(name) }, window, service, frame.url);
    const trusted = { sender: window.webContents, senderFrame: frame };
    expect(await handlers.get('fyspoti:request-code')!({ ...trusted, senderFrame: { url: frame.url } }, 'a@example.test')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handlers.get('fyspoti:request-code')!(trusted, 'not-email')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(await handlers.get('fyspoti:sign-out')!(trusted, { anything: true })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(service.signOut).not.toHaveBeenCalled(); expect(service.requestEmailCode).not.toHaveBeenCalled();
    await handlers.get('fyspoti:request-code')!(trusted, ' Test@Example.test ');
    expect(service.requestEmailCode).toHaveBeenCalledWith('test@example.test');
    expect(handlers.has('invoke')).toBe(false); dispose(); expect(handlers.size).toBe(0);
  });
});
