import type { TrackMetadataSnapshot } from '@fyspoti/contracts';
import { provisionalTrackId } from './identity.js';
import type { ImportedList, ImportedRow, ParsedSpotifyExport, SkipCounts } from './parse-export.js';

export type RowResolution =
  | { status: 'resolved'; trackId: string; metadataSnapshot: TrackMetadataSnapshot; provisional: boolean }
  | { status: 'ambiguous' | 'unmatched'; reason: string };

export type ImportResolver = (row: ImportedRow) => Promise<RowResolution>;

export interface PreviewRow {
  row: ImportedRow;
  resolution: RowResolution;
}

export interface ImportPreviewEntry {
  kind: 'playlist' | 'liked-songs';
  title: string;
  rows: PreviewRow[];
  skipped: SkipCounts;
  counts: { resolved: number; ambiguous: number; unmatched: number; duplicates: number };
}

export interface ImportPreview {
  entries: ImportPreviewEntry[];
  /** Shown to the user so nothing disappears unexplained; not imported yet. */
  notImported: { savedAlbums: number; savedArtists: number };
}

const MAX_TITLE = 200;
const LIKED_SONGS_TITLE = 'Liked Songs (from Spotify)';
const UNTITLED = 'Untitled playlist';

const clampTitle = (title: string): string => [...title].slice(0, MAX_TITLE).join('').trim();

/**
 * Keeps a row's text with a provisional ID until the catalog can match it. The export
 * has no durations, so durationMs is 0, which consumers must treat as unknown.
 */
export const provisionalResolver: ImportResolver = async (row) => ({
  status: 'resolved',
  provisional: true,
  trackId: await provisionalTrackId(row.uri),
  metadataSnapshot: { title: row.title, artistNames: [row.artistName], durationMs: 0 },
});

async function previewList(list: ImportedList, kind: ImportPreviewEntry['kind'], title: string, resolver: ImportResolver): Promise<ImportPreviewEntry> {
  const rows: PreviewRow[] = [];
  for (const row of list.rows) rows.push({ row, resolution: await resolver(row) });

  const count = (status: RowResolution['status']) => rows.filter(({ resolution }) => resolution.status === status).length;
  return {
    kind,
    title,
    rows,
    skipped: list.skipped,
    counts: {
      resolved: count('resolved'),
      ambiguous: count('ambiguous'),
      unmatched: count('unmatched'),
      duplicates: rows.length - new Set(list.rows.map((row) => row.uri)).size,
    },
  };
}

/** Writes nothing. A user reviews this before applyImportEntry touches their library. */
export async function previewSpotifyImport(parsed: ParsedSpotifyExport, resolver: ImportResolver = provisionalResolver): Promise<ImportPreview> {
  const entries: ImportPreviewEntry[] = [];
  if (parsed.likedSongs) entries.push(await previewList(parsed.likedSongs, 'liked-songs', LIKED_SONGS_TITLE, resolver));
  for (const playlist of parsed.playlists) {
    entries.push(await previewList(playlist, 'playlist', clampTitle(playlist.title ?? '') || UNTITLED, resolver));
  }
  return { entries, notImported: { savedAlbums: parsed.savedAlbums, savedArtists: parsed.savedArtists } };
}
