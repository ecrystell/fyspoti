import type { ExplicitStatus, VersionFlag } from '@fyspoti/contracts';
import { uuidV5 } from '../spotify-import/identity.js';
import { normalizeText, parseTitle } from './version.js';

// Fixed for this app. Changing it, or the key below, gives every saved track a new
// identity, so a new rule must use a new namespace and a migration plan.
const CATALOG_NAMESPACE = '6b3f0c1e-52a7-4d38-8f4e-1a9d7c2e5b10';

// Wide enough that reissues share an ID, while two songs with one name usually do not.
const DURATION_BUCKET_MS = 10_000;

export interface RecordingIdentity {
  title: string;
  primaryArtist: string;
  durationMs: number;
  explicit: ExplicitStatus;
  versionFlags: VersionFlag[];
}

/** Provider-free, so every install derives the same ID for a recording with no server. */
export const recordingKey = ({ title, primaryArtist, durationMs, explicit, versionFlags }: RecordingIdentity): string =>
  [
    'recording',
    normalizeText(primaryArtist),
    parseTitle(title).base,
    Math.round(durationMs / DURATION_BUCKET_MS),
    [...versionFlags].sort().join(','),
    explicit === 'explicit' ? 'explicit' : '',
  ].join('\n');

export const recordingId = (identity: RecordingIdentity): Promise<string> => uuidV5(CATALOG_NAMESPACE, recordingKey(identity));

export const providerEntityId = (kind: 'album' | 'artist', provider: string, providerId: string): Promise<string> =>
  uuidV5(CATALOG_NAMESPACE, [kind, provider, providerId].join('\n'));

export const candidateId = (trackId: string, provider: string, sourceId: string): Promise<string> =>
  uuidV5(CATALOG_NAMESPACE, ['candidate', trackId, provider, sourceId].join('\n'));
