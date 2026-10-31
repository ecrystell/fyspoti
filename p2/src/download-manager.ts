import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadJob, DownloadRequest, LocalArtifact } from './contracts.ts';
import { DownloadStore } from './download-store.ts';

export interface WorkerPaths {
  python: string;
  script: string;
  ffprobe: string;
  ffmpeg?: string;
  spotdl?: string;
}

export interface DownloadOptions {
  maxBytes?: number;
  minFreeBytes?: number;
}

type Listener = (job: DownloadJob) => void;

export class DownloadManager {
  readonly store: DownloadStore;
  private readonly worker: WorkerPaths;
  private listeners = new Set<Listener>();
  private running?: { id: string; child: ChildProcessWithoutNullStreams; cancelled: boolean };
  private starting = false;
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private scheduled = false;
  private options: Required<DownloadOptions>;

  constructor(store: DownloadStore, worker: WorkerPaths, options: DownloadOptions = {}) {
    this.store = store; this.worker = worker;
    this.options = { maxBytes: options.maxBytes ?? 10 * 1024 ** 3, minFreeBytes: options.minFreeBytes ?? 512 * 1024 ** 2 };
  }

  async open(): Promise<void> {
    await this.store.open();
    const known = new Set(this.store.artifacts().map(a => a.fileName));
    for (const artifact of this.store.artifacts()) {
      try { if ((await stat(path.join(this.store.root, 'artifacts', artifact.fileName))).size !== artifact.bytes) throw new Error('Changed artifact'); }
      catch {
        await this.store.removeArtifact(artifact.id);
        const job = this.store.jobs().find(j => j.artifactId === artifact.id);
        if (job) await this.change(job, { status: 'failed', artifactId: undefined, error: 'Offline artifact missing or changed' });
      }
    }
    for (const name of await readdir(path.join(this.store.root, 'artifacts'))) if (!known.has(name)) await rm(path.join(this.store.root, 'artifacts', name), { force: true });
    for (const name of await readdir(path.join(this.store.root, 'tmp'))) if (/^[0-9a-f-]{36}$/i.test(name)) await rm(path.join(this.store.root, 'tmp', name), { recursive: true, force: true });
    for (const job of this.store.jobs()) {
      if (['resolving', 'transferring', 'processing', 'verifying'].includes(job.status)) await this.change(job, { status: 'queued', error: 'Recovered after restart' });
      if (job.status === 'retry-wait') await this.change(job, { status: 'queued' });
    }
    this.schedule();
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  jobs(): DownloadJob[] { return this.store.jobs(); }
  artifacts(): LocalArtifact[] { return this.store.artifacts(); }
  shutdown(): void { for (const timer of this.retryTimers) clearTimeout(timer); this.retryTimers.clear(); if (this.running) this.killTree(this.running.child); }

  async enqueueCollection(requests: DownloadRequest[]): Promise<DownloadJob[]> {
    const jobs: DownloadJob[] = [];
    for (const request of requests) jobs.push(await this.enqueue(request));
    return jobs;
  }

  async enqueue(request: DownloadRequest): Promise<DownloadJob> {
    if (!request.trackId || !request.candidateId || !/^https?:\/\//.test(request.url)) throw new Error('Invalid download request');
    if (request.sourceKind === 'spotdl' && !request.url.startsWith('https://open.spotify.com/track/')) throw new Error('Invalid spotDL track URL');
    if (request.sourceKind === 'spotdl' && !/^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)/.test(request.matchedAudioUrl ?? '')) throw new Error('spotDL requires an approved YouTube candidate URL');
    const existing = this.store.jobs().find(j => j.trackId === request.trackId && j.candidateId === request.candidateId && !['failed', 'cancelled'].includes(j.status));
    if (existing) return existing;
    const now = Date.now();
    const job: DownloadJob = { ...request, id: randomUUID(), status: 'queued', bytesDone: 0, attempts: 0, createdAt: now, updatedAt: now };
    await this.change(job, {});
    this.schedule();
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = this.requireJob(id);
    if (job.status === 'complete' || job.status === 'cancelled') return;
    if (this.running?.id === id) { this.running.cancelled = true; this.killTree(this.running.child); }
    await this.change(job, { status: 'cancelled', error: undefined });
  }

  async retry(id: string): Promise<void> {
    const job = this.requireJob(id);
    if (!['failed', 'cancelled', 'retry-wait'].includes(job.status)) throw new Error('Job is not retryable');
    await this.change(job, { status: 'queued', error: undefined, bytesDone: 0 });
    this.schedule();
  }

  async removeArtifact(id: string): Promise<void> {
    const artifact = this.store.artifacts().find(a => a.id === id);
    if (!artifact) return;
    await this.store.removeArtifact(id);
    await rm(path.join(this.store.root, 'artifacts', artifact.fileName), { force: true });
  }

  async artifactPath(id: string): Promise<string> {
    const artifact = this.store.artifacts().find(a => a.id === id);
    if (!artifact) throw new Error('Artifact not found');
    const file = path.join(this.store.root, 'artifacts', artifact.fileName);
    const info = await stat(file);
    if (!info.isFile() || info.size !== artifact.bytes) throw new Error('Offline artifact missing or changed');
    return file;
  }

  private requireJob(id: string): DownloadJob { const job = this.store.jobs().find(j => j.id === id); if (!job) throw new Error('Job not found'); return job; }
  private async change(job: DownloadJob, changes: Partial<DownloadJob>): Promise<void> { const updated = { ...job, ...changes, updatedAt: Date.now() }; await this.store.putJob(updated); for (const listener of this.listeners) listener(updated); }
  private schedule(): void { if (this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; void this.runNext(); }); }

  private async runNext(): Promise<void> {
    if (this.running || this.starting) return;
    const job = this.store.jobs().find(j => j.status === 'queued');
    if (!job) return;
    this.starting = true;
    try {
      const free = await statfs(this.store.root);
      const available = free.bavail * free.bsize;
      const used = this.store.artifacts().reduce((sum, a) => sum + a.bytes, 0);
      if (used + (job.expectedBytes ?? 0) > this.options.maxBytes || available < this.options.minFreeBytes + (job.expectedBytes ?? 0)) {
        await this.change(job, { status: 'failed', error: 'DISK_FULL' }); this.starting = false; this.schedule(); return;
      }
    } catch (error) {
      await this.change(job, { status: 'failed', error: error instanceof Error ? error.message : String(error) }); this.starting = false; this.schedule(); return;
    }
    if (this.requireJob(job.id).status !== 'queued') { this.starting = false; this.schedule(); return; }
    const workDir = path.join(this.store.root, 'tmp', job.id);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(path.dirname(workDir), { recursive: true });
    if (this.requireJob(job.id).status !== 'queued') { this.starting = false; this.schedule(); return; }
    await this.change(job, { status: 'resolving', attempts: job.attempts + 1 });
    if (this.requireJob(job.id).status === 'cancelled') { this.starting = false; this.schedule(); return; }
    const child = spawn(this.worker.python, [this.worker.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    this.running = { id: job.id, child, cancelled: false };
    this.starting = false;
    try {
      const result = await this.communicate(child, job, workDir);
      if (this.running.cancelled || this.requireJob(job.id).status === 'cancelled') return;
      const suffix = path.extname(result.fileName).toLowerCase();
      if (!/^\.[a-z0-9]{2,5}$/.test(suffix)) throw new Error('Invalid output extension');
      const artifactId = randomUUID();
      const fileName = artifactId + suffix;
      const source = path.join(workDir, result.fileName);
      const size = (await stat(source)).size;
      if (size !== result.bytes) throw new Error('Output size mismatch');
      const target = path.join(this.store.root, 'artifacts', fileName);
      await rename(source, target);
      const artifact: LocalArtifact = { id: artifactId, trackId: job.trackId, candidateId: job.candidateId, fileName, bytes: size, mimeType: result.mimeType, verifiedAt: Date.now() };
      await this.store.putArtifact(artifact);
      await this.change(this.requireJob(job.id), { status: 'complete', artifactId, bytesDone: size, bytesTotal: size });
    } catch (error) {
      if (this.requireJob(job.id).status !== 'cancelled') {
        const message = error instanceof Error ? error.message : String(error);
        if (job.attempts + 1 < 3 && /timed out|HTTP Error 5|connection|reset|temporar|worker exited/i.test(message)) {
          await this.change(this.requireJob(job.id), { status: 'retry-wait', error: message });
          const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            const current = this.requireJob(job.id);
            if (current.status === 'retry-wait') void this.change(current, { status: 'queued', error: undefined }).then(() => this.schedule());
          }, 2000 * (job.attempts + 1));
          this.retryTimers.add(timer);
        } else await this.change(this.requireJob(job.id), { status: 'failed', error: message });
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
      this.running = undefined;
      this.schedule();
    }
  }

  private communicate(child: ChildProcessWithoutNullStreams, job: DownloadJob, workDir: string): Promise<{ fileName: string; bytes: number; mimeType: string }> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      let completed: { fileName: string; bytes: number; mimeType: string } | undefined;
      const timeout = setTimeout(() => { this.killTree(child); fail(new Error('Download timed out')); }, 15 * 60 * 1000);
      const fail = (error: Error) => { if (settled) return; settled = true; clearTimeout(timeout); this.killTree(child); reject(error); };
      child.on('error', fail);
      child.stderr.on('data', () => { /* Diagnostics must never include credentials in app logs. */ });
      child.stdout.on('data', data => {
        buffer += data.toString();
        if (buffer.length > 1_000_000) return fail(new Error('Worker protocol overflow'));
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const message = JSON.parse(line);
            if (message.type === 'hello') {
              if (message.protocol !== 1) throw new Error('Worker protocol mismatch');
              child.stdin.write(JSON.stringify({ type: 'download', protocol: 1, workDir, url: job.url, matchedAudioUrl: job.matchedAudioUrl, sourceKind: job.sourceKind, maxBytes: this.options.maxBytes, ffprobeExecutable: this.worker.ffprobe, ffmpegExecutable: this.worker.ffmpeg, spotdlExecutable: this.worker.spotdl }) + '\n');
            } else if (message.type === 'progress') {
              const stage = message.stage;
              if (['transferring', 'processing', 'verifying'].includes(stage) && this.requireJob(job.id).status !== 'cancelled') void this.change(this.requireJob(job.id), { status: stage, bytesDone: Number(message.bytesDone) || 0, bytesTotal: Number(message.bytesTotal) || undefined }).catch(fail);
            } else if (message.type === 'complete') completed = { fileName: String(message.fileName), bytes: Number(message.bytes), mimeType: String(message.mimeType) };
            else if (message.type === 'error') fail(new Error(String(message.message)));
          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        }
      });
      child.on('close', code => { if (settled) return; settled = true; clearTimeout(timeout); if (code === 0 && completed) resolve(completed); else reject(new Error('Worker exited before completing download')); });
    });
  }

  private killTree(child: ChildProcessWithoutNullStreams): void {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
    else child.kill('SIGKILL');
  }
}
