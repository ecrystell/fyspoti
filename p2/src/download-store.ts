import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadJob, LocalArtifact } from './contracts.ts';

interface Data { version: 1; jobs: DownloadJob[]; artifacts: LocalArtifact[] }

export class DownloadStore {
  private data: Data = { version: 1, jobs: [], artifacts: [] };
  private writing: Promise<void> = Promise.resolve();
  readonly root: string;
  constructor(root: string) { this.root = root; }
  async open(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, 'artifacts'), { recursive: true });
    await mkdir(path.join(this.root, 'tmp'), { recursive: true });
    try { const parsed = JSON.parse(await readFile(path.join(this.root, 'downloads.json'), 'utf8')); if (parsed.version !== 1 || !Array.isArray(parsed.jobs) || !Array.isArray(parsed.artifacts)) throw new Error('Unsupported download database'); this.data = parsed; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  jobs(): DownloadJob[] { return this.data.jobs.map(job => ({ ...job })); }
  artifacts(): LocalArtifact[] { return this.data.artifacts.map(artifact => ({ ...artifact })); }
  artifactFor(trackId: string): LocalArtifact | undefined { return this.data.artifacts.find(a => a.trackId === trackId); }
  async putJob(job: DownloadJob): Promise<void> { this.data.jobs = this.data.jobs.filter(j => j.id !== job.id).concat({ ...job }); await this.flush(); }
  async putArtifact(artifact: LocalArtifact): Promise<void> { this.data.artifacts = this.data.artifacts.filter(a => a.id !== artifact.id).concat({ ...artifact }); await this.flush(); }
  async removeArtifact(id: string): Promise<void> { this.data.artifacts = this.data.artifacts.filter(a => a.id !== id); await this.flush(); }
  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    const task = this.writing.then(async () => {
      const temp = path.join(this.root, 'downloads.json.tmp');
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, path.join(this.root, 'downloads.json'));
    });
    this.writing = task.catch(() => {});
    return task;
  }
}
