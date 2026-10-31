import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DownloadManager } from '../src/download-manager.ts';
import { DownloadStore } from '../src/download-store.ts';

test('direct download survives store reopening and resolves an offline artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fyspoti-p2-manager-'));
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) });
    response.end(wav);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unexpected address');
    const script = fileURLToPath(new URL('../worker/worker.py', import.meta.url));
    const manager = new DownloadManager(new DownloadStore(root), { python: process.env.PYTHON || 'python', script, ffprobe: 'ffprobe' }, { minFreeBytes: 0 });
    await manager.open();
    const job = await manager.enqueue({ trackId: 'track', candidateId: 'candidate', sourceKind: 'direct', url: `http://127.0.0.1:${address.port}/sample.wav` });
    const completed = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Download did not finish')), 10000);
      const unsubscribe = manager.subscribe(update => {
        if (update.id !== job.id) return;
        if (update.status === 'complete') { clearTimeout(timeout); unsubscribe(); resolve(update.artifactId!); }
        if (update.status === 'failed') { clearTimeout(timeout); unsubscribe(); reject(new Error(update.error)); }
      });
    });
    assert.ok((await manager.artifactPath(completed)).endsWith('.wav'));
    const reopened = new DownloadStore(root); await reopened.open();
    assert.equal(reopened.artifactFor('track')?.id, completed);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelled queued download never reaches the worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fyspoti-p2-cancel-'));
  let requests = 0;
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const server = createServer((_request, response) => {
    requests++;
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav); }, 300);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unexpected address');
    const manager = new DownloadManager(new DownloadStore(root), { python: process.env.PYTHON || 'python', script: fileURLToPath(new URL('../worker/worker.py', import.meta.url)), ffprobe: 'ffprobe' }, { minFreeBytes: 0 });
    await manager.open();
    const url = `http://127.0.0.1:${address.port}/sample.wav`;
    const first = await manager.enqueue({ trackId: 'one', candidateId: 'one', sourceKind: 'direct', url });
    const second = await manager.enqueue({ trackId: 'two', candidateId: 'two', sourceKind: 'direct', url });
    await manager.cancel(second.id);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('First job did not finish')), 10000);
      const unsubscribe = manager.subscribe(job => {
        if (job.id === first.id && job.status === 'complete') { clearTimeout(timeout); unsubscribe(); resolve(); }
        if (job.id === first.id && job.status === 'failed') { clearTimeout(timeout); unsubscribe(); reject(new Error(job.error)); }
      });
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(manager.jobs().find(job => job.id === second.id)?.status, 'cancelled');
    assert.equal(requests, 1);
  } finally { server.close(); await rm(root, { recursive: true, force: true }); }
});
