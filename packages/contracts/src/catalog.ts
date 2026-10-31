import { z } from 'zod';
import { Artwork, ProviderRef } from './common.ts';

export const AppId = z.string().min(1);

export const ArtistCredit = z.strictObject({
  id: AppId,
  name: z.string().min(1),
});
export type ArtistCredit = z.infer<typeof ArtistCredit>;

// Three states because MusicBrainz has no explicit flag: absence of evidence must
// stay distinguishable from a recording known not to be explicit.
export const ExplicitStatus = z.enum(['explicit', 'not-explicit', 'unknown']);
export type ExplicitStatus = z.infer<typeof ExplicitStatus>;

export const VersionFlag = z.enum([
  'live',
  'remix',
  'remaster',
  'cover',
  'acoustic',
  'instrumental',
  'radio-edit',
  'clean-edit',
  're-recording',
  'demo',
  'karaoke',
]);
export type VersionFlag = z.infer<typeof VersionFlag>;

// Strict: an unknown key such as a stream URL must fail rather than leak into
// identity or cloud sync.
export const Track = z.strictObject({
  id: AppId,
  title: z.string().min(1),
  artists: z.array(ArtistCredit).min(1),
  albumId: AppId.nullable(),
  durationMs: z.number().int().positive(),
  explicit: ExplicitStatus,
  isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/).optional(),
  versionFlags: z.array(VersionFlag),
  artwork: z.array(Artwork),
  providerRefs: z.array(ProviderRef).min(1),
});
export type Track = z.infer<typeof Track>;

export const Album = z.strictObject({
  id: AppId,
  title: z.string().min(1),
  artists: z.array(ArtistCredit).min(1),
  kind: z.enum(['album', 'ep', 'single', 'compilation', 'other']),
  releaseDate: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).optional(),
  trackIds: z.array(AppId),
  artwork: z.array(Artwork),
  providerRefs: z.array(ProviderRef).min(1),
});
export type Album = z.infer<typeof Album>;

export const Artist = z.strictObject({
  id: AppId,
  name: z.string().min(1),
  disambiguation: z.string().min(1).optional(),
  artwork: z.array(Artwork),
  providerRefs: z.array(ProviderRef).min(1),
});
export type Artist = z.infer<typeof Artist>;

export const SearchHit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('track'), track: Track }),
  z.strictObject({ kind: z.literal('album'), album: Album }),
  z.strictObject({ kind: z.literal('artist'), artist: Artist }),
]);
export type SearchHit = z.infer<typeof SearchHit>;

export const RecommendationContext = z.strictObject({
  surface: z.enum(['home', 'radio']),
  seedTrackId: AppId.optional(),
  // When set, tracks with explicit status 'unknown' are excluded too: the filter
  // fails closed because a parent's setting must not depend on provider coverage.
  filterExplicit: z.boolean(),
  excludedTrackIds: z.array(AppId),
  blockedArtistIds: z.array(AppId),
});
export type RecommendationContext = z.infer<typeof RecommendationContext>;

export const Recommendation = z.strictObject({
  track: Track,
  reason: z.string().min(1),
});
export type Recommendation = z.infer<typeof Recommendation>;
