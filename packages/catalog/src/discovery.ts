import {
  BrowseShelf,
  Recommendation,
  RecommendationContext,
  type Artist,
  type BrowsePlaylist,
  type CatalogApi,
  type ContentFilter,
  type Cursor,
  type DiscoveryApi,
  type LyricsDocument,
  type Page,
  type Result,
  type ShelfItem,
  type Track,
} from '@fyspoti/contracts';
import { LRCLIB_PROVIDER, lyricsDocument, type LyricsPort, type LyricsRequest } from './lyrics/lrclib.js';
import { canUseStale, decodeCursor, encodeCursor, fail, guarded, ok, present } from './result.js';
import type { CatalogStore } from './store.js';
import { albumFromRow, artistFromRow, playlistFromRow } from './youtube/normalize.js';
import { ProviderFailure, YTMUSIC_PROVIDER, type AlbumRow, type HomeShelfRow, type TrackRow, type YtMusicPort } from './youtube/port.js';

const PAGE_SIZE = 20;
const RADIO_LIMIT = 50;
const PLAYLIST_LIMIT = 100;
const HOME_SHELVES = 6;
const MAX_SUGGESTIONS = 8;
const MIN_SUGGESTION_LENGTH = 2;
const LIST_CACHE_SIZE = 50;
const LYRICS_CACHE_SIZE = 200;
const LIST_TTL_MS = 30 * 60 * 1000;
const LYRICS_TTL_MS = 60 * 60 * 1000;

interface Held<T> {
  value: T;
  expiresAt: number;
}

/** A short-lived memory cache that keeps expired answers to use during an outage. */
function createHolder<T>(size: number, ttlMs: number, now: () => number) {
  const items = new Map<string, Held<T>>();
  return {
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const held = items.get(key);
      if (held && held.expiresAt > now()) return held.value;
      try {
        const value = await load();
        items.delete(key);
        items.set(key, { value, expiresAt: now() + ttlMs });
        if (items.size > size) items.delete(items.keys().next().value as string);
        return value;
      } catch (error) {
        if (held && canUseStale(error)) return held.value;
        throw error;
      }
    },
  };
}

// Fails closed: 'unknown' counts as explicit, as the capability matrix decided.
function allowsTrack(track: Track, filter: ContentFilter): boolean {
  if (filter.excludedTrackIds.includes(track.id)) return false;
  if (track.artists.some((artist) => filter.blockedArtistIds.includes(artist.id))) return false;
  return !filter.filterExplicit || track.explicit === 'not-explicit';
}

function allowsAlbum(row: AlbumRow, artistIds: string[], filter: ContentFilter): boolean {
  if (artistIds.some((id) => filter.blockedArtistIds.includes(id))) return false;
  return !filter.filterExplicit || row.isExplicit === false;
}

const pageOf = <T>(items: T[], key: string, cursor: Cursor | null): Result<Page<T>> => {
  const offset = cursor === null ? 0 : decodeCursor(cursor, key);
  if (offset === null) return fail({ code: 'UNAVAILABLE', message: 'This page has expired', retryable: false });
  const end = offset + PAGE_SIZE;
  return ok({ items: items.slice(offset, end), nextCursor: end < items.length ? encodeCursor(key, end) : null });
};

const cancelledIf = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');
};

export interface DiscoveryOptions {
  ytMusic: YtMusicPort;
  store: CatalogStore;
  lyrics: LyricsPort;
  rememberRow: (row: TrackRow) => Promise<Track | null>;
  now: () => number;
}

export function createDiscovery({ ytMusic, store, lyrics, rememberRow, now }: DiscoveryOptions): DiscoveryApi & Pick<CatalogApi, 'getRecommendations'> {
  const homes = createHolder<HomeShelfRow[]>(1, LIST_TTL_MS, now);
  const radios = createHolder<Track[]>(LIST_CACHE_SIZE, LIST_TTL_MS, now);
  const playlists = createHolder<Track[]>(LIST_CACHE_SIZE, LIST_TTL_MS, now);
  const words = createHolder<LyricsDocument | null>(LYRICS_CACHE_SIZE, LYRICS_TTL_MS, now);

  // Reads back through the store, which may know more than this row did.
  const remembered = async (rows: TrackRow[]): Promise<Track[]> =>
    present(await Promise.all(rows.map(rememberRow))).map((track) => store.getTrack(track.id) ?? track);

  const homeRows = (signal?: AbortSignal) => homes.get('home', () => ytMusic.home(HOME_SHELVES, signal));

  const playlistTracks = (ref: string, signal?: AbortSignal) =>
    playlists.get(ref, async () => remembered(await ytMusic.playlist(ref, PLAYLIST_LIMIT, signal)));

  async function shelfItem(item: HomeShelfRow['items'][number], filter: ContentFilter): Promise<ShelfItem | null> {
    if (item.kind === 'track') {
      const [track] = await remembered([item.row]);
      return track && allowsTrack(track, filter) ? { kind: 'track', track } : null;
    }
    if (item.kind === 'playlist') {
      const playlist = playlistFromRow(item.row);
      return playlist && { kind: 'playlist', playlist };
    }
    const album = await albumFromRow(item.row);
    if (!album || !allowsAlbum(item.row, album.artists.map((artist) => artist.id), filter)) return null;
    const ref = album.providerRefs[0]?.id;
    if (ref) store.rememberAlbumRef(album.id, ref, album.title);
    return { kind: 'album', album };
  }

  /** The tracks behind a recommendation surface, each with the reason it is there. */
  async function recommended(context: RecommendationContext, signal?: AbortSignal): Promise<Array<{ track: Track; reason: string }> | null> {
    if (context.seedTrackId) {
      const seed = store.getTrack(context.seedTrackId);
      const ref = seed?.providerRefs.find((item) => item.provider === YTMUSIC_PROVIDER);
      if (!seed || !ref) return null;
      const tracks = await radios.get(ref.id, async () => remembered(await ytMusic.radio(ref.id, RADIO_LIMIT, signal)));
      const reason = context.surface === 'radio' ? `Radio based on ${seed.title}` : `Because you played ${seed.title}`;
      return tracks.filter((track) => track.id !== seed.id).map((track) => ({ track, reason }));
    }
    if (context.surface === 'radio') return null;

    // A new person has no history, and this says so plainly: popular, not personal.
    const shelves = await homeRows(signal);
    const first = shelves.flatMap((shelf) => shelf.items).find((item) => item.kind === 'playlist');
    if (first?.kind !== 'playlist' || !first.row.playlistId) return [];
    const reason = `Popular now: ${first.row.title ?? 'featured playlist'}`;
    return (await playlistTracks(first.row.playlistId, signal)).map((track) => ({ track, reason }));
  }

  return {
    getRecommendations: (input, cursor, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const context = RecommendationContext.parse(input);
        const items = await recommended(context, options?.signal);
        if (!items) return fail({ code: 'UNAVAILABLE', message: 'Radio needs a track found through search', retryable: false });
        const allowed = items.filter(({ track }) => allowsTrack(track, context)).map((item) => Recommendation.parse(item));
        return pageOf(allowed, JSON.stringify(context), cursor);
      }),

    getLyrics: (trackId, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const track = store.getTrack(trackId);
        const hint = options?.hint;
        const artist = track?.artists[0]?.name ?? hint?.artistNames[0];
        const title = track?.title ?? hint?.title;
        if (!artist || !title) return fail({ code: 'UNAVAILABLE', message: `Unknown track: ${trackId}`, retryable: false });
        // There are no words to look up, and a provider row could only be the wrong one.
        if (track?.versionFlags.some((flag) => flag === 'instrumental' || flag === 'karaoke')) return ok(null);

        const albumName = track?.albumId ? store.getAlbumName(track.albumId) : hint?.album;
        const durationMs = track?.durationMs ?? hint?.durationMs ?? 0;
        const request: LyricsRequest = { title, artist, durationMs, ...(albumName ? { album: albumName } : {}) };
        return ok(await words.get(trackId, async () => {
          const record = await lyrics.find(request, options?.signal);
          return record && lyricsDocument(trackId, record, durationMs);
        }));
      }, LRCLIB_PROVIDER, 'LRCLIB'),

    getSuggestions: (query, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const needle = query.trim();
        if (needle.length < MIN_SUGGESTION_LENGTH) return ok<string[]>([]);
        return ok((await ytMusic.suggestions(needle, options?.signal)).slice(0, MAX_SUGGESTIONS));
      }),

    getHomeShelves: (filter, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const shelves = await Promise.all(
          (await homeRows(options?.signal)).map(async (shelf) => {
            const items = present(await Promise.all(shelf.items.map((item) => shelfItem(item, filter))));
            return shelf.title && items.length > 0 ? BrowseShelf.parse({ title: shelf.title, items }) : null;
          }),
        );
        return ok(present(shelves));
      }),

    getMoods: (options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        return ok((await ytMusic.moods(options?.signal)).flatMap(({ group, title, params }) => (group && title && params ? [{ ref: params, title, group }] : [])));
      }),

    getMoodPlaylists: (ref, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        return ok<BrowsePlaylist[]>(present((await ytMusic.moodPlaylists(ref, options?.signal)).map(playlistFromRow)));
      }),

    getPlaylistTracks: (ref, filter, cursor, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const tracks = (await playlistTracks(ref, options?.signal)).filter((track) => allowsTrack(track, filter));
        return pageOf(tracks, JSON.stringify([ref, filter]), cursor);
      }),

    getRelatedArtists: (artistId, options) =>
      guarded(async () => {
        cancelledIf(options?.signal);
        const browseId = store.artistRef(artistId);
        if (!browseId) return fail({ code: 'UNAVAILABLE', message: `Unknown artist: ${artistId}`, retryable: false });
        const artists = present(await Promise.all((await ytMusic.relatedArtists(browseId, options?.signal)).map(artistFromRow)));
        for (const artist of artists) {
          const ref = artist.providerRefs[0]?.id;
          if (ref) store.rememberArtistRef(artist.id, ref);
        }
        return ok<Artist[]>(artists);
      }),
  };
}
