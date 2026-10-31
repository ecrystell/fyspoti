import { z } from 'zod';
import { Track } from './catalog.ts';
import type { AppError, Result } from './common.ts';
import type { LibraryAction, LibraryQueue, LibraryQueueItem, LibraryViewState, MutationContext, TrackLike } from './library.ts';

export interface Profile { id: string; displayName: string; revision: number }
export interface AccountState {
  phase: 'signed-out' | 'restoring' | 'sending-code' | 'awaiting-code' | 'verifying' | 'authenticated' | 'reauth-required' | 'unavailable';
  userId: string | null;
  email: string | null;
  pendingEmail: string | null;
  resendAt: number;
  persistent: boolean;
  storageNotice: string | null;
  error: AppError | null;
}
export interface DesktopState { version: number; account: AccountState; profile: Profile | null; library: LibraryViewState }
export interface CloudBridge {
  getState(): Promise<DesktopState>;
  requestEmailCode(email: string): Promise<Result<AccountState>>;
  verifyEmailCode(email: string, code: string): Promise<Result<AccountState>>;
  cancelEmailCode(): Promise<Result<AccountState>>;
  retryRestore(): Promise<Result<AccountState>>;
  signOut(): Promise<Result<AccountState>>;
  updateDisplayName(displayName: string, context: MutationContext): Promise<Result<Profile>>;
  load(playlistId?: string): Promise<Result<void>>;
  loadMore(kind: 'playlists' | 'likes' | 'items'): Promise<Result<void>>;
  run(action: LibraryAction): Promise<Result<unknown>>;
  retryConflict(): Promise<Result<unknown>>;
  retryUncertain(): Promise<Result<unknown>>;
  prepareQueue(playlistId: string): Promise<Result<LibraryQueue>>;
  prepareLikedQueue(): Promise<Result<LibraryQueueItem[]>>;
  getTrackLike(trackId: string): Promise<Result<TrackLike>>;
  subscribe(listener: (state: DesktopState) => void): () => void;
}
const id = z.uuid();
const snapshot = z.strictObject({ title: z.string().trim().min(1).max(500), artistNames: z.array(z.string().trim().min(1).max(500)).min(1).max(50), durationMs: z.number().int().min(0).max(86400000) });
export const LibraryActionSchema: z.ZodType<LibraryAction> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create'), title: z.string().trim().min(1).max(200) }),
  z.strictObject({ type: z.literal('like'), track: Track, liked: z.boolean() }),
  z.strictObject({ type: z.literal('likeSnapshot'), trackId: z.string().min(1).max(256), metadataSnapshot: snapshot, liked: z.boolean() }),
  z.strictObject({ type: z.literal('append'), playlistId: id, track: Track }),
  z.strictObject({ type: z.literal('rename'), playlistId: id, title: z.string().trim().min(1).max(200) }),
  z.strictObject({ type: z.literal('remove'), playlistId: id, itemId: id }),
  z.strictObject({ type: z.literal('reorder'), playlistId: id, itemIds: z.array(id).max(10000) }),
  z.strictObject({ type: z.literal('delete'), playlistId: id }),
]);
export const DesktopSchemas = {
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  verify: z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), code: z.string().regex(/^\d{6}$/) }),
  profile: z.strictObject({ displayName: z.string().trim().min(1).max(80), context: z.strictObject({ mutationId: id, expectedRevision: z.number().int().positive() }) }),
  playlistId: id.optional(),
  requiredId: id,
  trackId: z.string().min(1).max(256),
  pageKind: z.enum(['playlists', 'likes', 'items']),
  action: LibraryActionSchema,
};
