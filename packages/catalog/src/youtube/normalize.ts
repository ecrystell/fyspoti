import { Album, Artist, Track, type Artwork, type BrowsePlaylist, type ExplicitStatus } from '@fyspoti/contracts';
import { providerEntityId, recordingId } from '../recording/identity.js';
import { albumFlags, parseTitle } from '../recording/version.js';
import type { SourceRow } from '../matching/score.js';
import { YTMUSIC_PROVIDER, type AlbumRow, type ArtistRow, type PlaylistRow, type TrackRow } from './port.js';

export const OFFICIAL_AUDIO_TYPE = 'MUSIC_VIDEO_TYPE_ATV';
const OFFICIAL_VIDEO_TYPE = 'MUSIC_VIDEO_TYPE_OMV';

const ALBUM_KINDS: Readonly<Record<string, Album['kind']>> = { album: 'album', ep: 'ep', single: 'single', compilation: 'compilation' };

const artworkOf = (thumbnails: TrackRow['thumbnails']): Artwork[] =>
  thumbnails.flatMap(({ url, width, height }) =>
    url?.startsWith('https://') ? [{ url, ...(width ? { widthPx: width } : {}), ...(height ? { heightPx: height } : {}) }] : [],
  );

const explicitOf = (row: TrackRow): ExplicitStatus => (row.isExplicit === true ? 'explicit' : row.isExplicit === false ? 'not-explicit' : 'unknown');

const namedArtists = (artists: TrackRow['artists']): Array<{ name: string; id?: string }> =>
  artists.flatMap(({ name, id }) => (name ? [{ name, ...(id ? { id } : {}) }] : []));

const creditsOf = (artists: TrackRow['artists']): Promise<Array<{ id: string; name: string }>> =>
  Promise.all(
    namedArtists(artists).map(async ({ name, id }) => ({
      name,
      // Some credits have no channel. They still need an ID, but cannot open a page.
      id: await providerEntityId('artist', id ? YTMUSIC_PROVIDER : 'name', id ?? name.toLowerCase()),
    })),
  );

/** Null when a row lacks what a Track requires, because a partial track cannot be played or saved. */
export async function trackFromRow(row: TrackRow): Promise<Track | null> {
  const seconds = row.durationSeconds ?? 0;
  const [first] = namedArtists(row.artists);
  if (!row.videoId || !row.title || !first || seconds <= 0) return null;

  const durationMs = Math.round(seconds * 1000);
  const explicit = explicitOf(row);
  const versionFlags = [...new Set([...parseTitle(row.title).flags, ...albumFlags(row.albumName)])];
  const id = await recordingId({ title: row.title, primaryArtist: first.name, durationMs, explicit, versionFlags });

  return Track.parse({
    id,
    title: row.title,
    artists: await creditsOf(row.artists),
    albumId: row.albumId ? await providerEntityId('album', YTMUSIC_PROVIDER, row.albumId) : null,
    durationMs,
    explicit,
    versionFlags,
    artwork: artworkOf(row.thumbnails),
    providerRefs: [{ provider: YTMUSIC_PROVIDER, id: row.videoId }],
  });
}

export async function albumFromRow(row: AlbumRow, trackIds: string[] = []): Promise<Album | null> {
  const artists = await creditsOf(row.artists);
  if (!row.browseId || !row.title || artists.length === 0) return null;
  const year = row.year && /^\d{4}$/.test(row.year) ? { releaseDate: row.year } : {};
  return Album.parse({
    id: await providerEntityId('album', YTMUSIC_PROVIDER, row.browseId),
    title: row.title,
    artists,
    kind: ALBUM_KINDS[row.type?.toLowerCase() ?? ''] ?? 'other',
    ...year,
    trackIds,
    artwork: artworkOf(row.thumbnails),
    providerRefs: [{ provider: YTMUSIC_PROVIDER, id: row.browseId }],
  });
}

export async function artistFromRow(row: ArtistRow): Promise<Artist | null> {
  if (!row.browseId || !row.name) return null;
  return Artist.parse({
    id: await providerEntityId('artist', YTMUSIC_PROVIDER, row.browseId),
    name: row.name,
    artwork: artworkOf(row.thumbnails),
    providerRefs: [{ provider: YTMUSIC_PROVIDER, id: row.browseId }],
  });
}

export function playlistFromRow(row: PlaylistRow): BrowsePlaylist | null {
  if (!row.playlistId || !row.title) return null;
  return { ref: row.playlistId, title: row.title, ...(row.description ? { description: row.description } : {}), artwork: artworkOf(row.thumbnails) };
}

/** Null when a row cannot be scored or handed to playback. */
export function sourceFromRow(row: TrackRow): SourceRow | null {
  const seconds = row.durationSeconds ?? 0;
  const artists = namedArtists(row.artists).map(({ name }) => name);
  if (!row.videoId || !row.title || artists.length === 0 || seconds <= 0) return null;
  return {
    sourceId: row.videoId,
    title: row.title,
    artists,
    ...(row.albumName ? { album: row.albumName } : {}),
    durationMs: Math.round(seconds * 1000),
    kind: row.videoType === OFFICIAL_AUDIO_TYPE ? 'official-audio' : row.videoType === OFFICIAL_VIDEO_TYPE ? 'official-video' : 'other',
    explicit: explicitOf(row),
  };
}
