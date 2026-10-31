import type { ExplicitStatus, MatchEvidence, VersionFlag } from '@fyspoti/contracts';
import { albumFlags, flagsInWords, normalizeText, parseTitle, tokens } from '../recording/version.js';

/** The recording we want. A durationMs of 0 means unknown, as in Spotify exports. */
export interface MatchTarget {
  title: string;
  artists: string[];
  durationMs: number;
  album?: string;
  explicit: ExplicitStatus;
}

export interface SourceRow {
  sourceId: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs: number;
  /** Provider upload class: label audio, an official video, or anything else. */
  kind: 'official-audio' | 'official-video' | 'other';
  explicit: ExplicitStatus;
}

export interface ScoredRow {
  row: SourceRow;
  confidence: number;
  versionFlags: VersionFlag[];
  evidence: MatchEvidence[];
  /** A different recording, not just a weaker fit. */
  rejected: boolean;
}

const WEIGHTS = {
  titleExact: 0.35,
  titlePartial: 0.2,
  artistExact: 0.3,
  artistPartial: 0.2,
  durationClose: 0.2,
  durationNear: 0.15,
  durationLoose: 0.05,
  officialAudio: 0.1,
  officialVideo: 0.05,
  album: 0.05,
  liveQualifier: 0.1,
  softVersionPenalty: 0.12,
  explicitPenalty: 0.25,
  durationPenalty: 0.2,
} as const;

const REJECTED_CONFIDENCE_CAP = 0.2;
const DURATION_REJECT_MS = 30_000;

// The same performance in a different master or cut, so a mismatch weakens a match
// without ruling it out. Every other flag means different audio.
const SOFT_FLAGS: ReadonlySet<VersionFlag> = new Set(['remaster', 'radio-edit']);

// The source of a song rarely says it is a cover of someone else's, so a target
// flagged 'cover' has nothing to require of a row by the right artist.
const UNREQUIRED_TARGET_FLAGS: ReadonlySet<VersionFlag> = new Set(['cover']);

const QUALIFIER_FILLER: ReadonlySet<string> = new Set(['live', 'at', 'in', 'from', 'on', 'the', 'version', 'recording', 'acoustic']);

const stripArtistPrefix =(base: string, artists: string[]): string => {
  for (const artist of artists) {
    const prefix = `${normalizeText(artist)} `;
    if (prefix.trim() && base.startsWith(prefix)) return base.slice(prefix.length);
  }
  return base;
};

const sameWords = (a: string, b: string): boolean => [...tokens(a)].sort().join(' ') === [...tokens(b)].sort().join(' ');

type NameFit = 'exact' | 'partial' | 'none';

function artistFit(target: string[], row: string[]): NameFit {
  // The worst case is a single short name inside a longer one, so require whole words.
  let best: NameFit = 'none';
  for (const wanted of target) {
    const wantedWords = tokens(wanted);
    for (const found of row) {
      if (sameWords(wanted, found)) return 'exact';
      const foundWords = tokens(found);
      const [shorter, longer] = wantedWords.length <= foundWords.length ? [wantedWords, foundWords] : [foundWords, wantedWords];
      if (shorter.length > 0 && shorter.every((word) => longer.includes(word))) best = 'partial';
    }
  }
  return best;
}

export function scoreRow(target: MatchTarget, row: SourceRow): ScoredRow {
  const evidence: MatchEvidence[] = [];
  const wanted = parseTitle(target.title);
  const parsed = parseTitle(row.title);
  const rowBase = stripArtistPrefix(parsed.base, [...target.artists, ...row.artists]);

  const wantedWords = wanted.base.split(' ').filter(Boolean);
  const rowWords = rowBase.split(' ').filter(Boolean);
  const extraWords = rowWords.filter((word) => !wantedWords.includes(word));
  const missingWords = wantedWords.filter((word) => !rowWords.includes(word));

  // Words outside brackets count too: uploads say "Song piano cover" with no punctuation.
  const rowFlags = [...new Set([...parsed.flags, ...albumFlags(row.album), ...flagsInWords(extraWords)])];
  const targetFlags = [...new Set([...wanted.flags, ...albumFlags(target.album)])];

  let confidence = 0;
  let rejected = false;

  if (wanted.base === rowBase) {
    confidence += WEIGHTS.titleExact;
    evidence.push({ signal: 'title-match', detail: 'Title is the same' });
  } else if (missingWords.length === 0 && extraWords.length <= 2) {
    confidence += WEIGHTS.titlePartial;
    evidence.push({ signal: 'title-match', detail: 'Title contains the requested title' });
  } else {
    rejected = true;
    evidence.push({ signal: 'title-mismatch', detail: 'Title is a different song' });
  }

  const artist = artistFit(target.artists, row.artists);
  if (artist === 'none') {
    rejected = true;
    evidence.push({ signal: 'artist-mismatch', detail: 'No requested artist is credited' });
  } else {
    confidence += artist === 'exact' ? WEIGHTS.artistExact : WEIGHTS.artistPartial;
    evidence.push({ signal: 'artist-match', detail: artist === 'exact' ? 'Artist is the same' : 'Artist is credited alongside others' });
  }

  if (target.durationMs > 0) {
    const difference = Math.abs(target.durationMs - row.durationMs);
    const detail = `Difference ${Math.round(difference / 1000)} s`;
    if (difference <= 2_000) confidence += WEIGHTS.durationClose;
    else if (difference <= 5_000) confidence += WEIGHTS.durationNear;
    else if (difference <= 15_000) confidence += WEIGHTS.durationLoose;
    else confidence -= WEIGHTS.durationPenalty;
    if (difference > DURATION_REJECT_MS) rejected = true;
    evidence.push({ signal: difference <= 15_000 ? 'duration-match' : 'duration-mismatch', detail });
  }

  for (const flag of rowFlags) {
    if (targetFlags.includes(flag)) continue;
    evidence.push({ signal: 'version-mismatch', detail: `Candidate is ${flag}, the track is not` });
    if (SOFT_FLAGS.has(flag)) confidence -= WEIGHTS.softVersionPenalty;
    else rejected = true;
  }
  for (const flag of targetFlags) {
    if (rowFlags.includes(flag) || UNREQUIRED_TARGET_FLAGS.has(flag)) continue;
    evidence.push({ signal: 'version-mismatch', detail: `Track is ${flag}, the candidate is not` });
    if (SOFT_FLAGS.has(flag)) confidence -= WEIGHTS.softVersionPenalty;
    else rejected = true;
  }
  const shared = targetFlags.filter((flag) => rowFlags.includes(flag));
  if (shared.length > 0) evidence.push({ signal: 'version-match', detail: `Both are ${shared.join(', ')}` });

  // "Live Aid" and "Live at Wembley" share a flag and are different performances.
  if (shared.includes('live')) {
    const place = tokens(wanted.qualifier).filter((word) => !QUALIFIER_FILLER.has(word));
    const rowQualifier = tokens(`${parsed.qualifier} ${row.album ?? ''}`);
    if (place.length > 0 && place.some((word) => rowQualifier.includes(word))) {
      confidence += WEIGHTS.liveQualifier;
      evidence.push({ signal: 'version-match', detail: 'Same performance named' });
    } else if (place.length > 0) {
      confidence -= WEIGHTS.liveQualifier;
      evidence.push({ signal: 'version-mismatch', detail: 'A different performance is named' });
    }
  }

  // Unknown on either side is no evidence: only a stated difference counts.
  if (target.explicit !== 'unknown' && row.explicit !== 'unknown' && target.explicit !== row.explicit) {
    confidence -= WEIGHTS.explicitPenalty;
    evidence.push({ signal: 'version-mismatch', detail: `Track is ${target.explicit}, the candidate is ${row.explicit}` });
  }

  if (row.kind === 'official-audio') {
    confidence += WEIGHTS.officialAudio;
    evidence.push({ signal: 'official-audio', detail: 'Label-supplied audio track' });
  } else if (row.kind === 'official-video' && target.durationMs > 0) {
    // Videos often carry an extended intro, so only a duration shows this is the same cut.
    confidence += WEIGHTS.officialVideo;
    evidence.push({ signal: 'official-audio', detail: 'Official music video' });
  }

  if (target.album && row.album && normalizeText(target.album) === normalizeText(row.album)) {
    confidence += WEIGHTS.album;
    evidence.push({ signal: 'album-match', detail: 'Album is the same' });
  }

  confidence = Math.max(0, Math.min(1, confidence));
  if (rejected) confidence = Math.min(confidence, REJECTED_CONFIDENCE_CAP);
  return { row, confidence: Math.round(confidence * 100) / 100, versionFlags: rowFlags, evidence, rejected };
}
