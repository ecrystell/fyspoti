import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYtMusicWorker, type YtMusicWorker } from '@fyspoti/catalog/youtube-worker';

const stub = fileURLToPath(new URL('../fixtures/catalog-worker-stub.mjs', import.meta.url));

let worker: YtMusicWorker;
const start = (options: { requestTimeoutMs?: number } = {}): YtMusicWorker => {
  worker = createYtMusicWorker({ python: process.execPath, pythonArgs: [], workerPath: stub, ...options });
  return worker;
};

afterEach(() => worker.close());

describe('catalog worker client', () => {
  it('matches overlapping replies to their requests and keeps non-Latin text', async () => {
    const client = start();
    const [first, second] = await Promise.all([client.searchTracks('one', 'songs', 5), client.searchTracks('two', 'songs', 5)]);
    expect(first[0]?.title).toBe('one 宇多田');
    expect(second[0]?.title).toBe('two 宇多田');
  });

  it('reports a provider refusal with its kind', async () => {
    await expect(start().searchTracks('limited', 'songs', 5)).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('rejects a reply that has changed shape instead of passing it on', async () => {
    await expect(start().searchTracks('changed-shape', 'songs', 5)).rejects.toMatchObject({ kind: 'provider' });
  });

  it('cancels a request without waiting for the worker', async () => {
    const controller = new AbortController();
    const search = start().searchTracks('slow', 'songs', 5, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(search).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('times out a request the worker never answers', async () => {
    await expect(start({ requestTimeoutMs: 50 }).searchTracks('slow', 'songs', 5)).rejects.toMatchObject({ kind: 'network' });
  });

  it('fails requests in flight when the worker dies, then recovers on the next call', async () => {
    const client = start();
    await expect(client.searchTracks('crash', 'songs', 5)).rejects.toMatchObject({ kind: 'provider' });
    await expect(client.searchTracks('back', 'songs', 5)).resolves.toHaveLength(1);
  });

  it('treats unreadable output as a dead worker', async () => {
    await expect(start().searchTracks('garbage', 'songs', 5)).rejects.toMatchObject({ kind: 'provider' });
  });

  it('reports a missing interpreter as a failure, not a crash', async () => {
    worker = createYtMusicWorker({ python: 'fyspoti-no-such-python', workerPath: stub });
    await expect(worker.searchTracks('one', 'songs', 5)).rejects.toMatchObject({ kind: 'provider' });
  });

  it('refuses a worker speaking another protocol version', async () => {
    vi.stubEnv('STUB_PROTOCOL', '99');
    await expect(start().searchTracks('one', 'songs', 5)).rejects.toThrow('protocol 99');
    vi.unstubAllEnvs();
  });
});
