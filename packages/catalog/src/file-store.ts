import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createMemoryCatalogStore, parseCatalogSnapshot, type CatalogSnapshot, type CatalogStore } from './store.js';

const SAVE_DELAY_MS = 2_000;

export interface FileStoreOptions {
  /** A device-local file, such as one under Electron's userData folder. */
  path: string;
  now?: () => number;
  maxEntries?: number;
  saveDelayMs?: number;
  /** Saving is best effort: a full disk must not stop search or playback. */
  onSaveError?: (error: unknown) => void;
}

export interface FileCatalogStore extends CatalogStore {
  /** Writes anything pending. Call before the app quits. */
  flush(): Promise<void>;
}

async function load(path: string): Promise<CatalogSnapshot | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let snapshot: CatalogSnapshot | null = null;
  try {
    snapshot = parseCatalogSnapshot(JSON.parse(text));
  } catch {
    snapshot = null;
  }
  // Kept aside, not deleted, because it may hold a person's match corrections.
  if (!snapshot) await rename(path, `${path}.unreadable`);
  return snapshot;
}

/**
 * The catalog store, saved to one JSON file. Node or Electron main only. Changes
 * collect in memory and are written together, through a temporary file so a crash
 * mid-save cannot damage the last good copy.
 */
export async function openFileCatalogStore({ path, now, maxEntries, saveDelayMs = SAVE_DELAY_MS, onSaveError }: FileStoreOptions): Promise<FileCatalogStore> {
  const initial = await load(path);
  let timer: NodeJS.Timeout | null = null;
  let dirty = false;
  let saving: Promise<void> = Promise.resolve();

  const save = (): Promise<void> => {
    saving = saving.then(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, JSON.stringify(store.snapshot()));
        await rename(`${path}.tmp`, path);
      } catch (error) {
        dirty = true; // The next change or flush tries again.
        onSaveError?.(error);
      }
    });
    return saving;
  };

  const store = createMemoryCatalogStore({
    ...(now ? { now } : {}),
    ...(maxEntries === undefined ? {} : { maxEntries }),
    initial,
    onChange: () => {
      dirty = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void save();
      }, saveDelayMs);
      timer.unref();
    },
  });

  return {
    ...store,
    flush: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      return save();
    },
  };
}
