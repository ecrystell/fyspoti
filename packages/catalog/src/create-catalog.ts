import { MatchResult, type AppError, type CatalogApi, type Cursor, type Page, type Result, type SearchHit, type SourceCandidate, type Track } from '@fyspoti/contracts';
import { classify } from './matching/classify.js';
import { scoreRow, type MatchTarget, type ScoredRow, type SourceRow } from './matching/score.js';
import { candidateId } from './recording/identity.js';
import { createMemoryCatalogStore, type CatalogStore, type MatchOverride } from './store.js';
import { albumFromRow, artistFromRow, sourceFromRow, trackFromRow } from './youtube/normalize.js';
import { ProviderFailure, YTMUSIC_PROVIDER, type TrackRow, type YtMusicPort } from './youtube/port.js';

const SEARCH_LIMIT = 20;
const MATCH_LIMIT = 25;
const SETTLED_CONFIDENCE = 0.9;
const PAGE_SIZE = 20;
const ALBUMS_PER_PAGE = 4;
const ARTISTS_PER_PAGE = 2;
const SEARCH_CACHE_SIZE = 50;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: AppError): Result<never> => ({ ok: false, error });
const unknownId = (kind: string, id: string): Result<never> => fail({ code: 'UNAVAILABLE', message: `Unknown ${kind}: ${id}`, retryable: false });

function toAppError(error: unknown): AppError {
  if (!(error instanceof ProviderFailure)) throw error;
  const provider = YTMUSIC_PROVIDER;
  switch (error.kind) {
    case 'cancelled':
      return { code: 'CANCELLED', message: 'Request was cancelled', retryable: false };
    case 'rate-limited':
      return { code: 'RATE_LIMITED', message: 'YouTube Music is limiting requests', retryable: true, retryAfterMs: 30_000, provider };
    case 'network':
      return { code: 'UNAVAILABLE', message: 'YouTube Music could not be reached', retryable: true, provider };
    case 'provider':
      return { code: 'UNAVAILABLE', message: `YouTube Music failed: ${error.message}`, retryable: true, provider };
  }
}

const guarded = async <T>(work: () => Promise<Result<T>>): Promise<Result<T>> => {
  try {
    return await work();
  } catch (error) {
    return fail(toAppError(error));
  }
};

const encodeCursor = (query: string, offset: number): Cursor => btoa(encodeURIComponent(JSON.stringify({ query, offset })));

function decodeCursor(cursor: Cursor, query: string): number | null {
  try {
    const value = JSON.parse(decodeURIComponent(atob(cursor))) as { query?: unknown; offset?: unknown };
    return value.query === query && typeof value.offset === 'number' ? value.offset : null;
  } catch {
    return null;
  }
}

const present = <T>(items: Array<T | null>): T[] => items.filter((item) => item !== null);

// Each page holds some of every kind, so a search for an album does not bury it
// behind a full page of songs. A kind that runs out leaves its slots to the others.
function mixedPages(tracks: SearchHit[], albums: SearchHit[], artists: SearchHit[]): SearchHit[] {
  const mixed: SearchHit[] = [];
  let [track, album, artist] = [0, 0, 0];
  while (track < tracks.length || album < albums.length || artist < artists.length) {
    const start = mixed.length;
    mixed.push(...albums.slice(album, album + ALBUMS_PER_PAGE), ...artists.slice(artist, artist + ARTISTS_PER_PAGE));
    album += ALBUMS_PER_PAGE;
    artist += ARTISTS_PER_PAGE;
    const slots = PAGE_SIZE - (mixed.length - start);
    mixed.splice(start, 0, ...tracks.slice(track, track + slots));
    track += slots;
  }
  return mixed;
}

export interface CatalogOptions {
  ytMusic: YtMusicPort;
  store?: CatalogStore;
  now?: () => number;
}

export interface Catalog extends CatalogApi {
  /** Saves a person's correction of a match for this track. */
  setMatchOverride(trackId: string, override: MatchOverride): void;
}

export function createCatalog({ ytMusic, store = createMemoryCatalogStore(), now = Date.now }: CatalogOptions): Catalog {
  const searches = new Map<string, { hits: SearchHit[]; expiresAt: number }>();

  async function rememberRow(row: TrackRow): Promise<Track | null> {
    const track = await trackFromRow(row);
    if (!track) return null;
    store.putTrack(track);
    if (row.albumId && track.albumId) store.rememberAlbumRef(track.albumId, row.albumId, row.albumName ?? undefined);
    await Promise.all(row.artists.map(async (artist) => {
      const credit = track.artists.find((item) => item.name === artist.name);
      if (credit && artist.id) store.rememberArtistRef(credit.id, artist.id);
    }));
    return track;
  }

  // Provider search has no paging, so the whole answer is held and paged here. That
  // also keeps a page stable while someone scrolls.
  async function searchAll(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
    const cached = searches.get(query);
    if (cached && cached.expiresAt > now()) return cached.hits;

    const [songs, albums, artists] = await Promise.all([
      ytMusic.searchTracks(query, 'songs', SEARCH_LIMIT, signal),
      // A song list with no albums is still useful, so these two may fail alone.
      ytMusic.searchAlbums(query, SEARCH_LIMIT, signal).catch(whenNotCancelled([])),
      ytMusic.searchArtists(query, SEARCH_LIMIT, signal).catch(whenNotCancelled([])),
    ]);

    const tracks = present(await Promise.all(songs.map(rememberRow)));
    const albumHits = present(await Promise.all(albums.map((row) => albumFromRow(row))));
    const artistHits = present(await Promise.all(artists.map(artistFromRow)));
    for (const album of albumHits) {
      const ref = album.providerRefs[0]?.id;
      if (ref) store.rememberAlbumRef(album.id, ref, album.title);
    }
    for (const artist of artistHits) {
      const ref = artist.providerRefs[0]?.id;
      if (ref) store.rememberArtistRef(artist.id, ref);
    }

    // Different releases of one recording share an ID, and a page must not repeat it.
    const seen = new Set<string>();
    const hits = mixedPages(
      tracks.filter((track) => !seen.has(track.id) && seen.add(track.id)).map((track) => ({ kind: 'track' as const, track })),
      albumHits.map((album) => ({ kind: 'album' as const, album })),
      artistHits.map((artist) => ({ kind: 'artist' as const, artist })),
    );

    searches.delete(query);
    searches.set(query, { hits, expiresAt: now() + SEARCH_CACHE_TTL_MS });
    if (searches.size > SEARCH_CACHE_SIZE) searches.delete(searches.keys().next().value as string);
    return hits;
  }

  const toCandidate = async (trackId: string, scored: ScoredRow): Promise<SourceCandidate> => ({
    id: await candidateId(trackId, YTMUSIC_PROVIDER, scored.row.sourceId),
    trackId,
    provider: YTMUSIC_PROVIDER,
    sourceId: scored.row.sourceId,
    durationMs: scored.row.durationMs,
    versionFlags: scored.versionFlags,
    confidence: scored.confidence,
    evidence: scored.evidence.length > 0 ? scored.evidence : [{ signal: 'no-results', detail: 'No evidence either way' }],
    accessBasis: 'unofficial-extraction',
  });

  async function fetchRows(target: MatchTarget, signal?: AbortSignal): Promise<SourceRow[]> {
    const query = `${target.artists[0] ?? ''} ${target.title}`.trim();
    // Label audio is the better source, so the video shelf is skipped when the song
    // shelf settles it. A loose duration fit does not: the exact cut may be over there.
    const songs = present((await ytMusic.searchTracks(query, 'songs', MATCH_LIMIT, signal)).map(sourceFromRow));
    const outcome = classify(songs.map((row) => scoreRow(target, row)), target);
    if (outcome.status === 'matched' && (target.durationMs === 0 || outcome.accepted.confidence >= SETTLED_CONFIDENCE)) return songs;

    const videos = present((await ytMusic.searchTracks(query, 'videos', MATCH_LIMIT, signal)).map(sourceFromRow));
    const seen = new Set(songs.map((row) => row.sourceId));
    return [...songs, ...videos.filter((row) => !seen.has(row.sourceId))];
  }

  async function matchTarget(trackId: string, target: MatchTarget, signal?: AbortSignal): Promise<MatchResult> {
    const override = store.getOverride(trackId);
    const rejectedIds = new Set(override?.rejectSourceIds ?? []);
    const rows = (await fetchRows(target, signal)).filter((row) => !rejectedIds.has(row.sourceId));
    const scored = rows.map((row) => scoreRow(target, row));

    const forced = override?.acceptSourceId ? scored.find((item) => item.row.sourceId === override.acceptSourceId) : undefined;
    if (forced) {
      const others = scored.filter((item) => item !== forced && !item.rejected);
      return MatchResult.parse({
        status: 'matched',
        trackId,
        accepted: { ...(await toCandidate(trackId, forced)), confidence: 1, evidence: [{ signal: 'manual-override', detail: 'Chosen by a person' }, ...forced.evidence] },
        alternatives: await Promise.all(others.map((item) => toCandidate(trackId, item))),
      });
    }

    const outcome = classify(scored, target);
    const candidates = (items: ScoredRow[]) => Promise.all(items.map((item) => toCandidate(trackId, item)));
    if (outcome.status === 'matched') {
      return MatchResult.parse({ status: 'matched', trackId, accepted: await toCandidate(trackId, outcome.accepted), alternatives: await candidates(outcome.alternatives) });
    }
    if (outcome.status === 'ambiguous') {
      return MatchResult.parse({ status: 'ambiguous', trackId, candidates: await candidates(outcome.candidates), reasons: outcome.reasons });
    }
    return MatchResult.parse({ status: 'no-match', trackId, rejected: await candidates(outcome.rejected), reasons: outcome.reasons });
  }

  // A track from search already names its source, so there is nothing to work out
  // and the person gets the row they picked.
  async function matchKnownTrack(track: Track): Promise<MatchResult | null> {
    const ref = track.providerRefs.find((item) => item.provider === YTMUSIC_PROVIDER);
    if (!ref || store.getOverride(track.id)) return null;
    return MatchResult.parse({
      status: 'matched',
      trackId: track.id,
      accepted: {
        id: await candidateId(track.id, YTMUSIC_PROVIDER, ref.id),
        trackId: track.id,
        provider: YTMUSIC_PROVIDER,
        sourceId: ref.id,
        durationMs: track.durationMs,
        versionFlags: track.versionFlags,
        confidence: 1,
        evidence: [{ signal: 'source-ref', detail: 'This track came from this source' }],
        accessBasis: 'unofficial-extraction',
      },
      alternatives: [],
    });
  }

  return {
    setMatchOverride: (trackId, override) => store.setOverride(trackId, override),

    search: (query, cursor, options) =>
      guarded(async () => {
        if (options?.signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');
        const needle = query.trim().replace(/\s+/g, ' ');
        if (!needle) return ok<Page<SearchHit>>({ items: [], nextCursor: null });
        const offset = cursor === null ? 0 : decodeCursor(cursor, needle);
        if (offset === null) return fail({ code: 'UNAVAILABLE', message: 'This search page has expired', retryable: false });
        const hits = await searchAll(needle, options?.signal);
        const end = offset + PAGE_SIZE;
        return ok({ items: hits.slice(offset, end), nextCursor: end < hits.length ? encodeCursor(needle, end) : null });
      }),

    getTrack: async (trackId, options) => {
      if (options?.signal?.aborted) return fail({ code: 'CANCELLED', message: 'Request was cancelled', retryable: false });
      const track = store.getTrack(trackId);
      return track ? ok(track) : unknownId('track', trackId);
    },

    getAlbum: (albumId, options) =>
      guarded(async () => {
        const browseId = store.albumRef(albumId);
        if (!browseId) return unknownId('album', albumId);
        const known = store.getAlbum(albumId);
        if (known && known.trackIds.length > 0) return ok(known);
        const detail = await ytMusic.album(browseId, options?.signal);
        const tracks = present(await Promise.all(detail.tracks.map(rememberRow)));
        const album = await albumFromRow(detail, tracks.map((track) => track.id));
        if (!album) return fail({ code: 'UNAVAILABLE', message: 'YouTube Music returned an incomplete album', retryable: false, provider: YTMUSIC_PROVIDER });
        store.putAlbum(album);
        return ok(album);
      }),

    getArtist: (artistId, options) =>
      guarded(async () => {
        const known = store.getArtist(artistId);
        if (known) return ok(known);
        const browseId = store.artistRef(artistId);
        if (!browseId) return unknownId('artist', artistId);
        const artist = await artistFromRow(await ytMusic.artist(browseId, options?.signal));
        if (!artist) return fail({ code: 'UNAVAILABLE', message: 'YouTube Music returned an incomplete artist', retryable: false, provider: YTMUSIC_PROVIDER });
        store.putArtist(artist);
        return ok(artist);
      }),

    // Task 12. An error, not an empty page, so a surface cannot look like "no music".
    getRecommendations: async () => fail({ code: 'UNAVAILABLE', message: 'Recommendations are not built yet', retryable: false }),

    findCandidates: (trackId, options) =>
      guarded(async () => {
        if (options?.signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');
        const track = store.getTrack(trackId);
        if (track) {
          const known = await matchKnownTrack(track);
          if (known) return ok(known);
          const album = track.albumId ? store.getAlbumName(track.albumId) : undefined;
          return ok(await matchTarget(trackId, {
            title: track.title,
            artists: track.artists.map((artist) => artist.name),
            durationMs: track.durationMs,
            explicit: track.explicit,
            ...(album ? { album } : {}),
          }, options?.signal));
        }
        const hint = options?.hint;
        if (!hint) return unknownId('track', trackId);
        return ok(await matchTarget(trackId, {
          title: hint.title,
          artists: hint.artistNames,
          durationMs: hint.durationMs,
          explicit: 'unknown',
          ...(hint.album ? { album: hint.album } : {}),
        }, options?.signal));
      }),
  };
}

const whenNotCancelled = <T>(fallback: T) => (error: unknown): T => {
  if (error instanceof ProviderFailure && error.kind === 'cancelled') throw error;
  return fallback;
};
