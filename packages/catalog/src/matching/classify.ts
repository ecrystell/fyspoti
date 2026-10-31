import type { MatchEvidence } from '@fyspoti/contracts';
import type { MatchTarget, ScoredRow } from './score.js';

export const ACCEPT_CONFIDENCE = 0.7;
export const CONSIDER_CONFIDENCE = 0.45;
// Closer than this and the score cannot separate two materially different versions.
const DECISIVE_MARGIN = 0.05;
const SAME_CUT_MS = 5_000;

export type Classification =
  | { status: 'matched'; accepted: ScoredRow; alternatives: ScoredRow[] }
  | { status: 'ambiguous'; candidates: ScoredRow[]; reasons: MatchEvidence[] }
  | { status: 'no-match'; rejected: ScoredRow[]; reasons: MatchEvidence[] };

type Target = Pick<MatchTarget, 'durationMs' | 'explicit'>;

const sameFlags = (a: ScoredRow, b: ScoredRow): boolean => [...a.versionFlags].sort().join() === [...b.versionFlags].sort().join();

// Whether a choice between two rows is one worth putting to a person. The same
// recording on two releases is a spare copy, not a choice.
function interchangeable(a: ScoredRow, b: ScoredRow, target: Target): boolean {
  if (!sameFlags(a, b)) return false;
  // P4's product decision: with no explicit data, as in Spotify exports, take the
  // explicit release and keep the clean one as an alternative. See docs/22-catalog-core.md.
  if (target.explicit !== 'unknown' && a.row.explicit !== b.row.explicit) return false;
  if (Math.abs(a.row.durationMs - b.row.durationMs) <= SAME_CUT_MS) return true;
  // With no duration, two label releases of one title are usually the album track and
  // a mislabeled compilation. The provider lists the real one first, and rank order holds.
  return target.durationMs === 0 && a.row.kind === 'official-audio' && b.row.kind === 'official-audio';
}

const rankOrder = (target: Target) => (a: ScoredRow, b: ScoredRow): number => {
  const preferred = (item: ScoredRow): number => (target.explicit === 'unknown' && item.row.explicit === 'explicit' ? 1 : 0);
  return b.confidence - a.confidence || preferred(b) - preferred(a);
};

export function classify(scored: ScoredRow[], target: Target): Classification {
  const ranked = [...scored].sort(rankOrder(target));
  const viable = ranked.filter((item) => !item.rejected && item.confidence >= CONSIDER_CONFIDENCE);
  const [best] = viable;

  if (!best) return { status: 'no-match', rejected: ranked, reasons: noMatchReasons(ranked) };

  const rival = viable.find((item) => item !== best && best.confidence - item.confidence < DECISIVE_MARGIN && !interchangeable(best, item, target));
  if (best.confidence >= ACCEPT_CONFIDENCE && !rival) {
    const cleanRelease = viable.some((item) => item.row.explicit === 'not-explicit' && item.confidence === best.confidence);
    const accepted =
      target.explicit === 'unknown' && best.row.explicit === 'explicit' && cleanRelease
        ? { ...best, evidence: [...best.evidence, { signal: 'version-match' as const, detail: 'Explicit release chosen because the track does not say which it is' }] }
        : best;
    return { status: 'matched', accepted, alternatives: viable.slice(1) };
  }
  if (viable.length >= 2) {
    return {
      status: 'ambiguous',
      candidates: viable,
      reasons: [{ signal: 'version-mismatch', detail: rival ? 'More than one version fits equally well' : 'No candidate is a confident match' }],
    };
  }
  return { status: 'no-match', rejected: ranked, reasons: [{ signal: 'version-mismatch', detail: 'The only plausible candidate is not a confident match' }] };
}

function noMatchReasons(ranked: ScoredRow[]): MatchEvidence[] {
  if (ranked.length === 0) return [{ signal: 'no-results', detail: 'The source returned nothing for this track' }];
  const seen = new Set<string>();
  const reasons = ranked
    .flatMap((item) => item.evidence)
    .filter((item) => item.signal.endsWith('-mismatch') && !seen.has(item.signal) && seen.add(item.signal));
  return reasons.length > 0 ? reasons : [{ signal: 'no-results', detail: 'No candidate was strong enough' }];
}
