import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PlaybackSnapshotSchema, type PlaybackSnapshot, type PlaybackSession, type Result, type AccountState } from '@fyspoti/contracts';
import type { Encryption } from './vault.js';

const envelope = z.strictObject({ version: z.literal(1), owner: z.uuid(), snapshot: PlaybackSnapshotSchema });
const failure = (message: string): Result<never> => ({ ok: false, error: { code: 'AUTH_REQUIRED', message, retryable: false } });

/** Independent of the credential vault: logging out retains each encrypted queue. */
export class AccountPlaybackStore {
  private writes = Promise.resolve();
  private memory = new Map<string, PlaybackSnapshot>();
  private persistent = false;
  private notice: string | null = null;
  private scope: PlaybackSession = { generation: 0, userId: null, available: false, persistent: false, notice: null };
  private key = 'initial';
  private listeners = new Set<(session: PlaybackSession) => void>();
  constructor(private readonly directory: string, private readonly encryption: Encryption) {}
  async initialize() {
    try { this.persistent = await this.encryption.available(); } catch { this.persistent = false; }
    if (!this.persistent) this.notice = 'Secure queue storage is unavailable. Playback is temporary for this run.';
  }
  session(): PlaybackSession { return { ...this.scope, persistent: this.persistent, notice: this.notice }; }
  subscribe(listener: (session: PlaybackSession) => void) { this.listeners.add(listener); listener(this.session()); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(this.session()); }
  setAccount(account: Pick<AccountState, 'phase' | 'userId'>) {
    const userId = account.phase === 'authenticated' ? account.userId : null;
    const available = !['restoring', 'unavailable'].includes(account.phase);
    const key = userId ?? (available ? 'guest' : 'blocked');
    if (key === this.key) return;
    this.key = key;
    this.scope = { ...this.scope, generation: this.scope.generation + 1, userId, available };
    this.emit();
  }
  valid(generation: number) { return generation === this.scope.generation && this.scope.available; }
  private file(owner: string) { return path.join(this.directory, z.uuid().parse(owner) + '.enc'); }
  async load(generation: number): Promise<Result<PlaybackSnapshot | null>> {
    if (!this.valid(generation)) return failure('The playback session changed.');
    const owner = this.scope.userId;
    if (!owner) return { ok: true, value: null };
    await this.writes;
    if (!this.valid(generation)) return failure('The playback session changed.');
    let snapshot = this.memory.get(owner) ?? null;
    if (this.persistent && !snapshot) {
      try {
        if ((await stat(this.file(owner))).size > 32 * 1024 * 1024) throw new Error('Queue file too large');
        const bytes = await readFile(this.file(owner));
        const decoded = envelope.parse(JSON.parse((await this.encryption.decrypt(bytes)).result));
        if (decoded.owner !== owner) throw new Error('Owner mismatch');
        snapshot = decoded.snapshot;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.notice = 'The saved queue could not be restored. Start a new queue.'; this.emit(); }
      }
    }
    return this.valid(generation) ? { ok: true, value: snapshot ? structuredClone(snapshot) : null } : failure('The playback session changed.');
  }
  async save(generation: number, value: unknown): Promise<Result<void>> {
    if (!this.valid(generation)) return failure('The playback session changed.');
    const parsed = PlaybackSnapshotSchema.safeParse(value);
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid playback snapshot or queue exceeds 10000 items.', retryable: false } };
    const owner = this.scope.userId;
    if (!owner) return { ok: true, value: undefined };
    const snapshot = structuredClone(parsed.data);
    // Accepted saves belong to the captured owner even if logout occurs while
    // encryption is running. A later save with the retired generation is denied.
    this.memory.set(owner, snapshot);
    const task = this.writes.then(async () => {
      if (!this.persistent) return;
      try {
        const bytes = await this.encryption.encrypt(JSON.stringify({ version: 1, owner, snapshot }));
        await mkdir(this.directory, { recursive: true });
        const file = this.file(owner); await writeFile(file + '.tmp', bytes, { mode: 0o600 }); await rename(file + '.tmp', file);
      } catch { this.persistent = false; this.notice = 'The queue could not be securely saved. Playback is temporary for this run.'; this.emit(); }
    });
    this.writes = task.catch(() => {}); await task;
    return { ok: true, value: undefined };
  }
  async close() { this.scope = { ...this.scope, generation: this.scope.generation + 1, available: false }; this.emit(); await this.writes; this.listeners.clear(); this.memory.clear(); }
}
