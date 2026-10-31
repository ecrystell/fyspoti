import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DownloadStore } from '../src/download-store.ts';

test('jobs and artifacts survive reopening', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fyspoti-p2-'));
  try {
    const first = new DownloadStore(root); await first.open();
    await first.putJob({ id: 'j', trackId: 't', candidateId: 'c', url: 'https://example.test/a.wav', sourceKind: 'direct', status: 'queued', bytesDone: 0, attempts: 0, createdAt: 1, updatedAt: 1 });
    await first.putArtifact({ id: 'a', trackId: 't', candidateId: 'c', fileName: 'a.wav', bytes: 1, mimeType: 'audio/wav', verifiedAt: 1 });
    const second = new DownloadStore(root); await second.open();
    assert.equal(second.jobs()[0].id, 'j');
    assert.equal(second.artifactFor('t')?.id, 'a');
  } finally { await rm(root, { recursive: true, force: true }); }
});
