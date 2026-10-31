import { LibraryError, type Cursor, type Library, type Page, type PlaylistItem } from '@fyspoti/contracts';

// Renderer side of P3's cloud library. Only a publishable key belongs here; the
// session lives in memory, so signing in again is expected after a restart until
// P3 delivers the desktop session service.

const url = import.meta.env.VITE_FYSPOTI_CLOUD_URL as string | undefined;
const publishableKey = import.meta.env.VITE_FYSPOTI_CLOUD_KEY as string | undefined;

export const cloudConfigured = Boolean(url && publishableKey);

export async function signIn(email: string, password: string): Promise<Library> {
  if (!url || !publishableKey) throw new LibraryError('UNAVAILABLE', 'Cloud library is not configured for this build.');
  // Loaded on demand so the Supabase client is not part of the startup bundle.
  const { createLibrary, createMemoryClient, signInWithPassword } = await import('@fyspoti/library');
  const client = createMemoryClient(url, publishableKey);
  await signInWithPassword(client, email, password);
  return createLibrary(client);
}

export async function allPages<T>(load: (cursor?: Cursor) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** M0 has no append operation; callers pick the next free key after the loaded items. */
export const nextOrderingKey = (items: PlaylistItem[]): number => items.reduce((max, item) => Math.max(max, item.orderingKey + 1), 0);

const messages: Partial<Record<LibraryError['code'], string>> = {
  AUTH_REQUIRED: 'Sign in to your cloud library again.',
  RATE_LIMITED: 'The cloud library is busy. Try again in a moment.',
  CONFLICT: 'This playlist changed elsewhere. Reopen it and try again.',
  NOT_FOUND: 'That cloud playlist is unavailable.',
  FORBIDDEN: 'This cloud operation is not permitted.',
  INVALID_ARGUMENT: 'The cloud library rejected this data.',
  UNAVAILABLE: 'The cloud library is unavailable. Check your connection and retry.',
};

export function describeCloudError(error: unknown): string {
  if (error instanceof LibraryError) return messages[error.code] ?? error.message;
  return 'The cloud library is unavailable. Check your connection and retry.';
}
