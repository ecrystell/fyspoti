import { unzipSync } from 'fflate';
import { ImportFormatError } from './errors.js';

export interface ExportFile {
  name: string;
  text: string;
}

// The same ZIP holds email, date of birth, address and payment files. Those are
// filtered out before decompression, so they never reach memory, logs or the cloud.
const WANTED_FILE = /^(?:Playlist\d*|YourLibrary)\.json$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? '';

export function readSpotifyArchive(archive: Uint8Array): ExportFile[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      filter(file) {
        if (!WANTED_FILE.test(baseName(file.name))) return false;
        if (file.originalSize > MAX_FILE_BYTES) throw new ImportFormatError(`${baseName(file.name)} is too large to import.`);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImportFormatError) throw error;
    throw new ImportFormatError('This file is not a readable ZIP archive.');
  }

  const decoder = new TextDecoder();
  const files = Object.entries(entries).map(([path, bytes]) => ({ name: baseName(path), text: decoder.decode(bytes) }));
  if (files.length === 0) {
    throw new ImportFormatError('No playlist or library files found. Use the "Account data" package, not "Extended streaming history".');
  }
  return files;
}
