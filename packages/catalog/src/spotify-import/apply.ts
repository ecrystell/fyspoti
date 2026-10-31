import { LibraryError, type Library, type LibraryErrorCode } from '@fyspoti/contracts';
import type { ImportPreviewEntry } from './preview.js';

export interface ImportResumePoint {
  playlistId: string;
  nextPosition: number;
}

export type ImportOutcome =
  | { status: 'complete'; playlistId: string; imported: number; notImported: number }
  | {
      status: 'interrupted';
      /** Null if the playlist was not confirmed created; a retry starts a new one. */
      resume: ImportResumePoint | null;
      imported: number;
      error: { code: LibraryErrorCode; retryable: boolean };
    };

/**
 * Always creates a new private playlist, so an import can never replace existing
 * content. Library writes carry no idempotency guarantee yet, so a failed write is
 * reported and never replayed automatically: the caller decides whether to resume.
 */
export async function applyImportEntry(library: Library, entry: ImportPreviewEntry, resume?: ImportResumePoint): Promise<ImportOutcome> {
  const resolved = entry.rows.flatMap(({ row, resolution }) => (resolution.status === 'resolved' ? [{ position: row.position, resolution }] : []));
  const pending = resume ? resolved.filter(({ position }) => position >= resume.nextPosition) : resolved;

  let playlistId = resume?.playlistId ?? null;
  let imported = 0;
  let position = pending[0]?.position ?? 0;
  try {
    playlistId ??= (await library.createPlaylist(entry.title)).id;

    for (const [index, item] of pending.entries()) {
      position = item.position;
      try {
        await library.addPlaylistItem(playlistId, {
          trackId: item.resolution.trackId,
          orderingKey: item.position,
          metadataSnapshot: item.resolution.metadataSnapshot,
        });
        imported += 1;
      } catch (error) {
        // The item an interrupted run stopped on may have saved before the reply was
        // lost. Its unique position proves that, so it counts as done, not as a clash.
        const alreadySaved = resume !== undefined && index === 0 && error instanceof LibraryError && error.code === 'CONFLICT';
        if (!alreadySaved) throw error;
      }
    }
  } catch (error) {
    if (!(error instanceof LibraryError)) throw error;
    return {
      status: 'interrupted',
      resume: playlistId ? { playlistId, nextPosition: position } : null,
      imported,
      error: { code: error.code, retryable: error.retryable },
    };
  }
  return { status: 'complete', playlistId, imported, notImported: entry.rows.length - resolved.length };
}
