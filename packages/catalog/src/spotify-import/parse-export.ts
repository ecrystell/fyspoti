import { z } from 'zod';
import { ImportFormatError } from './errors.js';
import type { ExportFile } from './read-archive.js';

export type SkipReason = 'episode' | 'audiobook' | 'local-track' | 'malformed';
export type SkipCounts = Record<SkipReason, number>;

export interface ImportedRow {
  /** Original index in the Spotify list, so skipped rows leave gaps instead of reordering. */
  position: number;
  uri: string;
  title: string;
  artistName: string;
  albumName: string | null;
}

export interface ImportedList {
  title: string | null;
  rows: ImportedRow[];
  skipped: SkipCounts;
}

export interface ParsedSpotifyExport {
  playlists: ImportedList[];
  likedSongs: ImportedList | null;
  /** Counted only: the library has no saved-album or saved-artist API yet. */
  savedAlbums: number;
  savedArtists: number;
}

// Field names come from observed exports. Spotify documents the contents but not the
// layout, so everything here is untrusted input that may change without notice.
const MAX_TEXT = 500;
const Text = z.string().trim().min(1).refine((value) => [...value].length <= MAX_TEXT && !value.includes('\0'));
const TrackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);
const AlbumName = z.string().trim().nullish();

const PlaylistTrack = z.object({ trackName: Text, artistName: Text, albumName: AlbumName, trackUri: TrackUri });
const LibraryTrack = z.object({ track: Text, artist: Text, album: AlbumName, uri: TrackUri });

const PlaylistItem = z.object({
  track: z.unknown().optional(),
  episode: z.unknown().optional(),
  audiobook: z.unknown().optional(),
  localTrack: z.unknown().optional(),
});

const PlaylistFile = z.object({
  playlists: z.array(z.object({ name: z.string().nullish(), items: z.array(z.unknown()) })),
});

const LibraryFile = z.object({
  tracks: z.array(z.unknown()).default([]),
  albums: z.array(z.unknown()).default([]),
  artists: z.array(z.unknown()).default([]),
});

const emptySkips = (): SkipCounts => ({ episode: 0, audiobook: 0, 'local-track': 0, malformed: 0 });

function parseFile<T>(file: ExportFile, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    throw new ImportFormatError(`${file.name} is not valid JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ImportFormatError(`${file.name} does not match the expected layout.`);
  return parsed.data;
}

function classifyPlaylistItem(value: unknown, position: number): ImportedRow | SkipReason {
  const item = PlaylistItem.safeParse(value);
  if (!item.success) return 'malformed';
  if (item.data.track) {
    const track = PlaylistTrack.safeParse(item.data.track);
    if (!track.success) return 'malformed';
    return { position, uri: track.data.trackUri, title: track.data.trackName, artistName: track.data.artistName, albumName: track.data.albumName ?? null };
  }
  if (item.data.episode) return 'episode';
  if (item.data.audiobook) return 'audiobook';
  if (item.data.localTrack) return 'local-track';
  return 'malformed';
}

function collect(values: unknown[], classify: (value: unknown, position: number) => ImportedRow | SkipReason, title: string | null, fileName: string): ImportedList {
  const rows: ImportedRow[] = [];
  const skipped = emptySkips();
  values.forEach((value, position) => {
    const result = classify(value, position);
    if (typeof result === 'string') skipped[result] += 1;
    else rows.push(result);
  });
  // Every row failing means the layout changed. Reporting an empty list instead would
  // look like a successful import that silently lost the user's music.
  if (values.length > 0 && skipped.malformed === values.length) {
    throw new ImportFormatError(`${fileName} has an unrecognized track layout.`);
  }
  return { title, rows, skipped };
}

const fileNumber = (name: string): number => Number(/\d+/.exec(name)?.[0] ?? 0);

export function parseSpotifyExport(files: ExportFile[]): ParsedSpotifyExport {
  const playlistFiles = files
    .filter((file) => file.name.startsWith('Playlist'))
    .sort((a, b) => fileNumber(a.name) - fileNumber(b.name));

  const playlists = playlistFiles.flatMap((file) =>
    parseFile(file, PlaylistFile).playlists.map((playlist) => collect(playlist.items, classifyPlaylistItem, playlist.name?.trim() || null, file.name)),
  );

  const libraryFile = files.find((file) => file.name === 'YourLibrary.json');
  const library = libraryFile ? parseFile(libraryFile, LibraryFile) : null;
  const likedSongs =
    libraryFile && library && library.tracks.length > 0
      ? collect(
          library.tracks,
          (value, position) => {
            const track = LibraryTrack.safeParse(value);
            if (!track.success) return 'malformed';
            return { position, uri: track.data.uri, title: track.data.track, artistName: track.data.artist, albumName: track.data.album ?? null };
          },
          null,
          libraryFile.name,
        )
      : null;

  return { playlists, likedSongs, savedAlbums: library?.albums.length ?? 0, savedArtists: library?.artists.length ?? 0 };
}
