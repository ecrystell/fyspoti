import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlayableSource, QueueItem, SourceResolver } from './contracts.ts';

const supported = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav']);

export class LocalFiles {
  private files = new Map<string, string>();
  private readonly storeFile?: string;
  constructor(storeFile?: string) { this.storeFile = storeFile; }
  async open(): Promise<void> {
    if (!this.storeFile) return;
    try {
      const saved = JSON.parse(await readFile(this.storeFile, 'utf8')) as Record<string, string>;
      for (const [id, file] of Object.entries(saved)) if (/^[0-9a-f-]{36}$/i.test(id) && typeof file === 'string') this.files.set(id, file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async add(filePath: string): Promise<QueueItem> {
    const absolute = path.resolve(filePath);
    if (!supported.has(path.extname(absolute).toLowerCase()) || !(await stat(absolute)).isFile()) throw new Error('Unsupported local audio file');
    const id = randomUUID();
    this.files.set(id, absolute);
    await this.save();
    return { id, trackId: `local:${id}`, title: path.basename(absolute, path.extname(absolute)), artist: 'Local file' };
  }
  pathFor(id: string): string | undefined { return this.files.get(id); }
  sourceFor(trackId: string): PlayableSource | undefined {
    if (!trackId.startsWith('local:')) return undefined;
    const id = trackId.slice(6);
    return this.files.has(id) ? { uri: `p2-media://local/${id}`, local: true, seekable: true } : undefined;
  }
  private async save(): Promise<void> {
    if (!this.storeFile) return;
    await mkdir(path.dirname(this.storeFile), { recursive: true });
    const temporary = this.storeFile + '.tmp';
    await writeFile(temporary, JSON.stringify(Object.fromEntries(this.files)), 'utf8');
    await rename(temporary, this.storeFile);
  }
}

export class LocalFirstResolver implements SourceResolver {
  private readonly local: LocalFiles;
  private readonly other: SourceResolver;
  constructor(local: LocalFiles, other: SourceResolver) { this.local = local; this.other = other; }
  resolve(item: QueueItem, signal: AbortSignal): Promise<PlayableSource> {
    const source = this.local.sourceFor(item.trackId);
    return source ? Promise.resolve(source) : this.other.resolve(item, signal);
  }
}
