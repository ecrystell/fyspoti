// Checks a real Spotify export against the importer without uploading anything.
// Run: npm run import:preview -- path/to/my_spotify_data.zip
// Prints counts only, never titles or account details, so the output is safe to share.
import { readFile } from 'node:fs/promises';
import { ImportFormatError, parseSpotifyExport, previewSpotifyImport, readSpotifyArchive } from '@fyspoti/catalog';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run import:preview -- path/to/my_spotify_data.zip');
  process.exit(2);
}

try {
  const files = readSpotifyArchive(await readFile(path));
  const preview = await previewSpotifyImport(parseSpotifyExport(files));
  const skippedTotal = (key) => preview.entries.reduce((sum, entry) => sum + entry.skipped[key], 0);
  console.log(JSON.stringify({
    filesRead: files.map((file) => file.name),
    playlists: preview.entries.filter((entry) => entry.kind === 'playlist').length,
    likedSongs: preview.entries.find((entry) => entry.kind === 'liked-songs')?.counts.resolved ?? 0,
    tracksReady: preview.entries.reduce((sum, entry) => sum + entry.counts.resolved, 0),
    duplicatesKept: preview.entries.reduce((sum, entry) => sum + entry.counts.duplicates, 0),
    skipped: { episodes: skippedTotal('episode'), audiobooks: skippedTotal('audiobook'), localTracks: skippedTotal('local-track'), malformed: skippedTotal('malformed') },
    notImportedYet: preview.notImported,
  }, null, 2));
} catch (error) {
  if (!(error instanceof ImportFormatError)) throw error;
  console.error(`Could not read this export: ${error.message}`);
  process.exit(1);
}
