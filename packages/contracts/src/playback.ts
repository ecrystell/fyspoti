import { z } from 'zod';
import type { Result } from './common.ts';

const identity = z.string().min(1).max(256).refine(value => !/^(?:https?:|file:|local:|p2-media:|data:|blob:)/i.test(value));
export const PlaybackItemSchema = z.strictObject({ id: z.uuid(), trackId: identity, title: z.string().min(1).max(500), artist: z.string().min(1).max(1000), durationMs: z.number().finite().min(0).max(86400000).optional(), candidateId: identity.optional() });
export const PlaybackStateSchema = z.strictObject({
  generation: z.number().int().nonnegative(), status: z.enum(['idle', 'resolving', 'buffering', 'playing', 'paused', 'ended', 'error']),
  currentItemId: z.uuid().nullable(), queue: z.array(PlaybackItemSchema).max(10000), positionMs: z.number().finite().min(0), durationMs: z.number().finite().min(0),
  volume: z.number().min(0).max(1), repeat: z.enum(['off', 'one', 'all']), shuffle: z.boolean(), error: z.string().max(1000).optional(),
}).superRefine((state, context) => {
  if (new Set(state.queue.map(item => item.id)).size !== state.queue.length || (state.currentItemId && !state.queue.some(item => item.id === state.currentItemId))) context.addIssue({ code: 'custom', message: 'Invalid queue identity' });
});
export const PlaybackSnapshotSchema = z.strictObject({ state: PlaybackStateSchema, modes: z.record(z.uuid(), z.enum(['full-track', 'preview'])), upcomingIds: z.array(z.uuid()).max(10000) }).superRefine((snapshot, context) => {
  const ids = new Set(snapshot.state.queue.map(item => item.id));
  if (new Set(snapshot.upcomingIds).size !== snapshot.upcomingIds.length || snapshot.upcomingIds.some(id => !ids.has(id) || id === snapshot.state.currentItemId) || Object.keys(snapshot.modes).some(id => !ids.has(id))) context.addIssue({ code: 'custom', message: 'Invalid queue snapshot' });
});
export type PlaybackSnapshot = z.infer<typeof PlaybackSnapshotSchema>;
export interface PlaybackSession { generation: number; userId: string | null; available: boolean; persistent: boolean; notice: string | null }
export const PlaybackSourceSchema = z.strictObject({ uri: z.url().max(16000).refine(value => value.startsWith('https://')), mimeType: z.string().max(256).optional(), expiresAt: z.number().finite().positive().optional(), seekable: z.boolean(), local: z.literal(false) });
export type PlaybackSource = z.infer<typeof PlaybackSourceSchema>;
export const PlaybackGenerationSchema = z.number().int().nonnegative();
export const PlaybackResolveSchema = z.strictObject({ generation: PlaybackGenerationSchema, track: PlaybackItemSchema });
export const PlaybackSaveSchema = z.strictObject({ generation: PlaybackGenerationSchema, snapshot: PlaybackSnapshotSchema });
export interface ScopedPlaybackBridge {
  session(): Promise<Result<PlaybackSession>>;
  load(generation: number): Promise<Result<PlaybackSnapshot | null>>;
  save(generation: number, snapshot: PlaybackSnapshot): Promise<Result<void>>;
  resolve(generation: number, track: z.infer<typeof PlaybackItemSchema>): Promise<Result<PlaybackSource>>;
  subscribe(listener: (session: PlaybackSession) => void): () => void;
}
