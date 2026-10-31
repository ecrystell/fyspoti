import { LyricsDocument, type TimedLyricLine } from '@fyspoti/contracts';
import { normalizeText, parseTitle } from '../recording/version.js';
import { ProviderFailure } from '../youtube/port.js';

export const LRCLIB_PROVIDER = 'lrclib';

const BASE_URL = 'https://lrclib.net/api';
const USER_AGENT = 'fyspoti (https://github.com/ecrystell/fyspoti)';
const REQUEST_TIMEOUT_MS = 10_000;
// LRCLIB's own tolerance. Beyond it, timings may belong to a different cut.
const TIMED_TOLERANCE_MS = 2_000;

export interface LyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricsRequest {
  title: string;
  artist: string;
  album?: string;
  /** 0 means unknown. */
  durationMs: number;
}

export interface LyricsPort {
  find(request: LyricsRequest, signal?: AbortSignal): Promise<LyricsRecord | null>;
}

const toRecord = (raw: unknown): LyricsRecord | null => {
  const value = raw as Partial<LyricsRecord> | null;
  if (typeof value?.id !== 'number' || typeof value.trackName !== 'string' || typeof value.artistName !== 'string') return null;
  return {
    id: value.id,
    trackName: value.trackName,
    artistName: value.artistName,
    duration: typeof value.duration === 'number' ? value.duration : null,
    instrumental: value.instrumental === true,
    plainLyrics: typeof value.plainLyrics === 'string' ? value.plainLyrics : null,
    syncedLyrics: typeof value.syncedLyrics === 'string' ? value.syncedLyrics : null,
  };
};

/** Best first: same song and artist, then the closest length. */
function bestRecord(records: LyricsRecord[], { title, artist, durationMs }: LyricsRequest): LyricsRecord | null {
  const base = parseTitle(title).base;
  const name = normalizeText(artist);
  const fits = records.filter((record) => parseTitle(record.trackName).base === base && normalizeText(record.artistName) === name && (record.plainLyrics || record.syncedLyrics || record.instrumental));
  const distance = (record: LyricsRecord): number => (durationMs > 0 && record.duration !== null ? Math.abs(record.duration * 1000 - durationMs) : 0);
  return [...fits].sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

export function createLrclib(fetchImpl: typeof fetch = fetch): LyricsPort {
  async function get(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown | null> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}/${path}?${new URLSearchParams(params)}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      if (signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');
      throw new ProviderFailure('network', 'LRCLIB did not answer');
    }
    if (response.status === 404) return null;
    if (response.status === 429) throw new ProviderFailure('rate-limited', 'HTTP 429');
    if (!response.ok) throw new ProviderFailure('network', `HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new ProviderFailure('provider', 'LRCLIB sent an unreadable reply');
    }
  }

  return {
    async find(request, signal) {
      if (request.durationMs > 0) {
        const exact = toRecord(
          await get('get', {
            track_name: request.title,
            artist_name: request.artist,
            duration: String(Math.round(request.durationMs / 1000)),
            ...(request.album ? { album_name: request.album } : {}),
          }, signal),
        );
        if (exact) return exact;
      }
      // Titles such as "Song - 2004 Remaster" are often stored as just "Song".
      const found = await get('search', { track_name: parseTitle(request.title).base, artist_name: request.artist }, signal);
      return bestRecord((Array.isArray(found) ? found : []).flatMap((item) => toRecord(item) ?? []), request);
    },
  };
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Reads LRC text. Lines with no time are skipped, and a line can hold several times. */
export function parseSyncedLyrics(text: string): TimedLyricLine[] {
  const offset = Number(/^\[offset:\s*([+-]?\d+)\]/im.exec(text)?.[1] ?? 0);
  const lines: TimedLyricLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const stamps = [...line.matchAll(STAMP)];
    if (stamps.length === 0) continue;
    const words = line.replace(STAMP, '').trim();
    for (const [, minutes, seconds, fraction = '0'] of stamps) {
      const fractionMs = Number(fraction.padEnd(3, '0'));
      lines.push({ startMs: Math.max(0, Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionMs + offset), text: words });
    }
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

export function lyricsDocument(trackId: string, record: LyricsRecord, durationMs: number): LyricsDocument | null {
  const timed = record.syncedLyrics ? parseSyncedLyrics(record.syncedLyrics) : [];
  const plainLines = record.plainLyrics ? record.plainLyrics.split(/\r?\n/) : timed.filter((line) => line.text).map((line) => line.text);
  if (plainLines.length === 0 && !record.instrumental) return null;

  // Wrongly timed lyrics look broken, while the words stay right. So when the length
  // cannot be confirmed, as for a live version or an import, only the words are used.
  const sameCut = durationMs > 0 && record.duration !== null && Math.abs(record.duration * 1000 - durationMs) <= TIMED_TOLERANCE_MS;

  return LyricsDocument.parse({
    trackId,
    language: null, // LRCLIB does not say.
    plainLines,
    timedLines: sameCut && timed.length > 0 ? timed : null,
    instrumental: record.instrumental,
    provenance: { provider: LRCLIB_PROVIDER, providerId: String(record.id) },
    permissions: { storeOnDisk: false, share: false }, // LRCLIB publishes no data license.
    revision: String(record.id),
  });
}
