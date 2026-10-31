import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { YoutubeSource } from '../src/youtube-source.ts';

// Stands in for youtube_source.py: logs each request, waits, then answers with a fake URL.
const fakeWorker = (log: string, expiresAt: number) => `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(request) + '\\n');
  setTimeout(() => console.log(JSON.stringify({ ok: true, value: { uri: 'https://media.example.test/' + (request.videoId || request.trackId), mimeType: 'audio/mp4', expiresAt: ${expiresAt} } })), 100);
});`;

async function withSource(expiresAt: number, run: (source: YoutubeSource, requests: () => Promise<Record<string, unknown>[]>) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fyspoti-p2-source-'));
  const log = path.join(root, 'requests.log');
  await writeFile(log, '');
  await writeFile(path.join(root, 'worker.cjs'), fakeWorker(log, expiresAt));
  try {
    await run(new YoutubeSource(process.execPath, path.join(root, 'worker.cjs')), async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  } finally { await rm(root, { recursive: true, force: true }); }
}

const track = { trackId: 'track-1', title: 'Example Song', artist: 'Example Artist', durationMs: 200000, candidateId: 'ytmusic:aaaaaaaaaaa' };

test('playback joins a prefetch in flight and reuses the cached source', async () => {
  await withSource(Date.now() + 6 * 3600000, async (source, requests) => {
    source.prefetch(track);
    const first = await source.resolve(track);
    const second = await source.resolve(track);
    assert.equal(first.uri, 'https://media.example.test/aaaaaaaaaaa');
    assert.equal(second.uri, first.uri);
    const sent = await requests();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { type: 'resolve', trackId: 'track-1', title: 'Example Song', artist: 'Example Artist', durationMs: 200000, videoId: 'aaaaaaaaaaa' });
  });
});

test('a cancelled caller does not discard the lookup for later playback', async () => {
  await withSource(Date.now() + 6 * 3600000, async (source, requests) => {
    const controller = new AbortController();
    const cancelled = source.resolve(track, controller.signal);
    controller.abort();
    await assert.rejects(cancelled, /cancelled/);
    await source.resolve(track);
    assert.equal((await requests()).length, 1);
  });
});

test('a source that would expire before the song ends is resolved again', async () => {
  await withSource(Date.now() + 120000, async (source, requests) => {
    await source.resolve(track);
    await source.resolve(track);
    assert.equal((await requests()).length, 2);
  });
});
