import { z } from 'zod';
import { AppId } from './catalog.ts';
import { VersionFlag } from './catalog.ts';

// How the app is allowed to reach this source. It is shown in the capability table
// and lets a build disable a whole class of source without touching match logic.
export const AccessBasis = z.enum([
  'open-license', // Each item carries its own license, such as Creative Commons.
  'platform-api', // A documented API from the platform that hosts the audio.
  'user-file', // A file the user already has on this device.
  'unofficial-extraction', // Not offered by the platform; see docs/16-provider-spike.md.
]);
export type AccessBasis = z.infer<typeof AccessBasis>;

export const MatchSignal = z.enum([
  'isrc-match',
  'title-match',
  'title-mismatch',
  'artist-match',
  'artist-mismatch',
  'duration-match',
  'duration-mismatch',
  'album-match',
  'version-match',
  'version-mismatch',
  'official-audio',
  'source-ref', // The track came from this source, so identity needed no search.
  'manual-override',
  'no-results',
]);
export type MatchSignal = z.infer<typeof MatchSignal>;

export const MatchEvidence = z.strictObject({
  signal: MatchSignal,
  detail: z.string().min(1),
});
export type MatchEvidence = z.infer<typeof MatchEvidence>;

// P4 owns this record. P2 turns an accepted one into an ephemeral PlayableSource,
// so it holds no URI, expiry or credential.
export const SourceCandidate = z.strictObject({
  id: AppId,
  trackId: AppId,
  provider: z.string().min(1),
  sourceId: z.string().min(1),
  durationMs: z.number().int().positive(),
  versionFlags: z.array(VersionFlag),
  confidence: z.number().min(0).max(1),
  evidence: z.array(MatchEvidence).min(1),
  accessBasis: AccessBasis,
  license: z.string().min(1).optional(),
});
export type SourceCandidate = z.infer<typeof SourceCandidate>;

export const MatchResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('matched'),
    trackId: AppId,
    accepted: SourceCandidate,
    alternatives: z.array(SourceCandidate),
  }),
  z.strictObject({
    status: z.literal('ambiguous'),
    trackId: AppId,
    candidates: z.array(SourceCandidate).min(2),
    reasons: z.array(MatchEvidence).min(1),
  }),
  z.strictObject({
    status: z.literal('no-match'),
    trackId: AppId,
    rejected: z.array(SourceCandidate),
    reasons: z.array(MatchEvidence).min(1),
  }),
]);
export type MatchResult = z.infer<typeof MatchResult>;
