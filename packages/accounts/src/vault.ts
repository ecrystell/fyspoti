import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Encryption {
  available(): Promise<boolean>;
  encrypt(text: string): Promise<Uint8Array>;
  decrypt(bytes: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** One serialized encrypted vault, with generation-bound storage handles per SDK client. */
export class SessionVault {
  private generation = 0;
  private values: Record<string, string> = {};
  private queue: Promise<void> = Promise.resolve();
  persistent = false;
  notice: string | null = null;
  constructor(private readonly file: string, private readonly encryption: Encryption) {}
  async initialize(): Promise<void> {
    try {
      this.persistent = await this.encryption.available();
      if (!this.persistent) { this.notice = 'Secure storage is unavailable. Sign-in lasts until the app closes.'; return; }
      const encrypted = await readFile(this.file);
      const decrypted = await this.encryption.decrypt(encrypted);
      const parsed: unknown = JSON.parse(decrypted.result);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('Invalid vault');
      this.values = parsed as Record<string, string>;
      if (decrypted.shouldReEncrypt) await this.persist(this.generation);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.persistent = false;
      this.notice = 'Saved sign-in could not be opened. A new sign-in will last until the app closes.';
    }
  }
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => {});
    return next;
  }
  private persist(generation: number): Promise<void> {
    const text = JSON.stringify(this.values);
    return this.enqueue(async () => {
      if (!this.persistent || generation !== this.generation) return;
      try {
        const bytes = await this.encryption.encrypt(text);
        if (generation !== this.generation) return;
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file + '.tmp', bytes, { mode: 0o600 });
        if (generation === this.generation) await rename(this.file + '.tmp', this.file);
        else await unlink(this.file + '.tmp').catch(() => {});
      } catch {
        this.persistent = false;
        this.notice = 'Secure storage could not save this session. Sign-in lasts until the app closes.';
      }
    });
  }
  storage(): AuthStorage {
    const generation = this.generation;
    return {
      getItem: async key => generation === this.generation ? this.values[key] ?? null : null,
      setItem: async (key, value) => { if (generation !== this.generation) return; this.values[key] = value; await this.persist(generation); },
      removeItem: async key => { if (generation !== this.generation) return; delete this.values[key]; await this.persist(generation); },
    };
  }
  async clear(): Promise<void> {
    this.generation++; this.values = {};
    await this.enqueue(async () => {
      for (const file of [this.file, this.file + '.tmp']) {
        try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    });
  }
  flush(): Promise<void> { return this.queue; }
}
