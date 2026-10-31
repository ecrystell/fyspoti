import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { AlbumDetail, AlbumRow, ArtistRow, HomeShelfRow, MoodRow, PlaylistRow, ProviderFailure, TrackRow, type YtMusicPort } from './port.js';

const PROTOCOL = 1;
const REQUEST_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 15_000;

const Reply = z.union([
  z.object({ type: z.literal('hello'), protocol: z.number() }),
  z.object({ id: z.number(), ok: z.literal(true), value: z.unknown() }),
  z.object({ id: z.number().nullable(), ok: z.literal(false), kind: z.enum(['rate-limited', 'network', 'provider']), message: z.string() }),
]);

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: ProviderFailure) => void;
}

export interface WorkerOptions {
  /** Path to the Python that has services/catalog-worker/requirements.txt installed. */
  python: string;
  /** Path to services/catalog-worker/worker.py. */
  workerPath: string;
  /** Interpreter flags. -I stops Python loading modules from the working folder. */
  pythonArgs?: string[];
  requestTimeoutMs?: number;
}

export interface YtMusicWorker extends YtMusicPort {
  close(): void;
}

/**
 * Starts the worker on first use and again after a crash, so one bad process costs
 * the requests in flight and not the session. For Electron main or Node only.
 */
export function createYtMusicWorker({ python, workerPath, pythonArgs = ['-I'], requestTimeoutMs = REQUEST_TIMEOUT_MS }: WorkerOptions): YtMusicWorker {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const stop = (failure: ProviderFailure): void => {
    child?.kill();
    child = null;
    ready = null;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };

  const start = (): Promise<void> => {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => {
      const startup = setTimeout(() => {
        reject(new ProviderFailure('provider', 'Catalog worker did not start in time'));
        stop(new ProviderFailure('provider', 'Catalog worker did not start in time'));
      }, STARTUP_TIMEOUT_MS);

      const process = spawn(python, [...pythonArgs, workerPath], { windowsHide: true });
      child = process;
      process.stdin.on('error', () => {}); // A dead worker is reported by the exit event.
      let stderrTail = '';
      process.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-500);
      });

      const lost = (message: string): void => {
        clearTimeout(startup);
        if (child !== process) return;
        const failure = new ProviderFailure('provider', message);
        reject(failure);
        stop(failure);
      };
      process.on('error', (error) => lost(`Catalog worker could not start: ${error.message}`));
      process.on('exit', (code) => lost(`Catalog worker exited with code ${code}. ${stderrTail}`.trim()));

      createInterface({ input: process.stdout }).on('line', (line) => {
        const parsed = Reply.safeParse(safeJson(line));
        if (!parsed.success) return lost('Catalog worker sent an unreadable message');
        const reply = parsed.data;
        if ('type' in reply) {
          clearTimeout(startup);
          if (reply.protocol !== PROTOCOL) return lost(`Catalog worker speaks protocol ${reply.protocol}, expected ${PROTOCOL}`);
          return resolve();
        }
        if (reply.id === null) return lost(`Catalog worker rejected a request: ${'message' in reply ? reply.message : ''}`);
        const request = pending.get(reply.id);
        if (!request) return; // Already cancelled or timed out.
        pending.delete(reply.id);
        if (reply.ok) request.resolve(reply.value);
        else request.reject(new ProviderFailure(reply.kind, reply.message));
      });
    });
    return ready;
  };

  async function call(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');
    await start();
    if (signal?.aborted) throw new ProviderFailure('cancelled', 'Request was cancelled');

    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      };
      // The worker cannot stop a call in flight, so a cancelled reply is simply dropped.
      const cancel = (): void => {
        finish();
        pending.delete(id);
        reject(new ProviderFailure('cancelled', 'Request was cancelled'));
      };
      const timeout = setTimeout(() => {
        finish();
        pending.delete(id);
        reject(new ProviderFailure('network', `YouTube Music did not answer in ${requestTimeoutMs} ms`));
      }, requestTimeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      pending.set(id, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      child?.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ProviderFailure('provider', 'YouTube Music returned an unexpected shape');
    return parsed.data;
  };

  return {
    searchTracks: async (query, filter, limit, signal) => parse(z.array(TrackRow), await call('search', { query, filter, limit }, signal)),
    searchAlbums: async (query, limit, signal) => parse(z.array(AlbumRow), await call('search', { query, filter: 'albums', limit }, signal)),
    searchArtists: async (query, limit, signal) => parse(z.array(ArtistRow), await call('search', { query, filter: 'artists', limit }, signal)),
    album: async (browseId, signal) => parse(AlbumDetail, await call('album', { browseId }, signal)),
    artist: async (browseId, signal) => parse(ArtistRow, await call('artist', { browseId }, signal)),
    relatedArtists: async (browseId, signal) => parse(z.array(ArtistRow), await call('related', { browseId }, signal)),
    radio: async (videoId, limit, signal) => parse(z.array(TrackRow), await call('radio', { videoId, limit }, signal)),
    home: async (limit, signal) => parse(z.array(HomeShelfRow), await call('home', { limit }, signal)),
    moods: async (signal) => parse(z.array(MoodRow), await call('moods', {}, signal)),
    moodPlaylists: async (params, signal) => parse(z.array(PlaylistRow), await call('moodPlaylists', { params }, signal)),
    playlist: async (playlistId, limit, signal) => parse(z.array(TrackRow), await call('playlist', { playlistId, limit }, signal)),
    suggestions: async (query, signal) => parse(z.array(z.string()), await call('suggestions', { query }, signal)),
    close: () => stop(new ProviderFailure('cancelled', 'Catalog worker closed')),
  };
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
