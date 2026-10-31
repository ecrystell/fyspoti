import type { AppError, Cursor, Result } from '@fyspoti/contracts';
import { ProviderFailure, YTMUSIC_PROVIDER } from './youtube/port.js';

const DEFAULT_RETRY_AFTER_MS = 30_000;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: AppError): Result<never> => ({ ok: false, error });

export const present = <T>(items: Array<T | null>): T[] => items.filter((item) => item !== null);

function toAppError(error: unknown, provider: string, label: string): AppError {
  if (!(error instanceof ProviderFailure)) throw error;
  switch (error.kind) {
    case 'cancelled':
      return { code: 'CANCELLED', message: 'Request was cancelled', retryable: false };
    case 'rate-limited':
      return { code: 'RATE_LIMITED', message: `${label} is limiting requests`, retryable: true, retryAfterMs: error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, provider };
    case 'network':
      return { code: 'UNAVAILABLE', message: `${label} could not be reached`, retryable: true, provider };
    case 'provider':
      return { code: 'UNAVAILABLE', message: `${label} failed: ${error.message}`, retryable: true, provider };
  }
}

export const guarded = async <T>(work: () => Promise<Result<T>>, provider = YTMUSIC_PROVIDER, label = 'YouTube Music'): Promise<Result<T>> => {
  try {
    return await work();
  } catch (error) {
    return fail(toAppError(error, provider, label));
  }
};

// Old data beats an error when the provider is down. A cancellation is the caller
// leaving, so it is never answered with stale data.
export const canUseStale = (error: unknown): boolean => error instanceof ProviderFailure && error.kind !== 'cancelled';

export const encodeCursor = (query: string, offset: number): Cursor => btoa(encodeURIComponent(JSON.stringify({ query, offset })));

export function decodeCursor(cursor: Cursor, query: string): number | null {
  try {
    const value = JSON.parse(decodeURIComponent(atob(cursor))) as { query?: unknown; offset?: unknown };
    return value.query === query && typeof value.offset === 'number' ? value.offset : null;
  } catch {
    return null;
  }
}
