import { z } from 'zod';

export const ErrorCode = z.enum([
  'UNAVAILABLE',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'NO_MATCH',
  'CONFLICT',
  'DISK_FULL',
  'CANCELLED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const AppError = z
  .object({
    code: ErrorCode,
    message: z.string().min(1),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    provider: z.string().min(1).optional(),
  })
  .refine((error) => error.code !== 'RATE_LIMITED' || error.retryable, {
    message: 'RATE_LIMITED must be retryable so the UI can offer recovery',
  });
export type AppError = z.infer<typeof AppError>;

// Errors travel as data so they survive the IPC boundary and cannot be mistaken
// for an empty result.
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const resultOf = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: AppError }),
  ]);

// Cursors are opaque. Offset-based providers hide their offsets behind them, so
// consumers must never parse or build one.
export const Cursor = z.string().min(1);
export type Cursor = z.infer<typeof Cursor>;

export type Page<T> = { items: T[]; nextCursor: Cursor | null };

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Cursor.nullable() });

// Provider media URLs are untrusted input, so only https is representable.
export const HttpsUrl = z.url({ protocol: /^https$/ });

export const ProviderRef = z.strictObject({
  provider: z.string().min(1),
  id: z.string().min(1),
  url: HttpsUrl.optional(),
  license: z.string().min(1).optional(),
});
export type ProviderRef = z.infer<typeof ProviderRef>;

export const Artwork = z.strictObject({
  url: HttpsUrl,
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
});
export type Artwork = z.infer<typeof Artwork>;
