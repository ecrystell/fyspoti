import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlayerState } from './contracts.ts';
import type { Player } from './player.ts';

export class PlayerPersistence {
  private timer?: ReturnType<typeof setTimeout>;
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  async load(): Promise<PlayerState | null> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as PlayerState;
      return Array.isArray(saved.queue) && ['off', 'one', 'all'].includes(saved.repeat) ? saved : null;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null; }
  }
  async restore(player: Player): Promise<void> { const saved = await this.load(); if (saved) player.restore(saved); }
  bind(player: Player): () => void {
    const unsubscribe = player.subscribe(state => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.save(state); }, 500);
    });
    return () => { unsubscribe(); if (this.timer) clearTimeout(this.timer); };
  }
  save(state: PlayerState): Promise<void> {
    const snapshot = JSON.stringify(state);
    const task = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp';
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, this.file);
    });
    this.writing = task.catch(() => {});
    return task;
  }
}
