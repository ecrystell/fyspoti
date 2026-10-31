import { ProviderFailure, type YtMusicPort } from './port.js';

const FIRST_WAIT_MS = 30_000;
const LONGEST_WAIT_MS = 10 * 60 * 1000;

/**
 * Stops calling the provider after it refuses us, for longer each time. YouTube
 * Music's real limits are unknown, and retrying through a limit risks a longer block.
 */
export function withBackoff(port: YtMusicPort, now: () => number): YtMusicPort {
  let blockedUntil = 0;
  let strikes = 0;

  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    if (now() < blockedUntil) throw new ProviderFailure('rate-limited', 'Waiting before calling YouTube Music again', blockedUntil - now());
    try {
      const value = await call();
      if (now() >= blockedUntil) strikes = 0;
      return value;
    } catch (error) {
      if (!(error instanceof ProviderFailure) || error.kind !== 'rate-limited') throw error;
      // One search sends several calls, and they all fail together. That is one strike.
      if (now() >= blockedUntil) {
        strikes += 1;
        blockedUntil = now() + Math.min(FIRST_WAIT_MS * 2 ** (strikes - 1), LONGEST_WAIT_MS);
      }
      throw new ProviderFailure('rate-limited', error.message, blockedUntil - now());
    }
  };

  return {
    searchTracks: (query, filter, limit, signal) => guard(() => port.searchTracks(query, filter, limit, signal)),
    searchAlbums: (query, limit, signal) => guard(() => port.searchAlbums(query, limit, signal)),
    searchArtists: (query, limit, signal) => guard(() => port.searchArtists(query, limit, signal)),
    album: (browseId, signal) => guard(() => port.album(browseId, signal)),
    artist: (browseId, signal) => guard(() => port.artist(browseId, signal)),
  };
}
