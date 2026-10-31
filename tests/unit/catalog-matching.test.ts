import { describe, expect, it } from 'vitest';
import { classify, parseTitle, recordingId, scoreRow, type MatchTarget, type SourceRow } from '@fyspoti/catalog';

// All names are invented. Real titles live only in the live labeled set.
const target = (overrides: Partial<MatchTarget> = {}): MatchTarget => ({
  title: 'Harbor Lights',
  artists: ['The Paper Lanterns'],
  durationMs: 214_000,
  explicit: 'unknown',
  ...overrides,
});

const row = (overrides: Partial<SourceRow> = {}): SourceRow => ({
  sourceId: 'src-1',
  title: 'Harbor Lights',
  artists: ['The Paper Lanterns'],
  durationMs: 214_000,
  kind: 'official-audio',
  explicit: 'not-explicit',
  ...overrides,
});

const statusFor = (wanted: MatchTarget, rows: SourceRow[]) => classify(rows.map((item) => scoreRow(wanted, item)), wanted);

describe('parseTitle', () => {
  it.each([
    ['Harbor Lights - Remastered 2009', 'harbor lights', ['remaster']],
    ['Harbor Lights (2018 Remaster)', 'harbor lights', ['remaster']],
    ['Harbor Lights (Live at the Quay)', 'harbor lights', ['live']],
    ['Harbor Lights - Live', 'harbor lights', ['live']],
    ['Harbor Lights (Radio Edit) [feat. Mira Vale]', 'harbor lights', ['radio-edit']],
    ['Harbor Lights (feat. Mira Vale)', 'harbor lights', []],
    ['Harbor Lights (Official Music Video)', 'harbor lights', []],
    ['Harbor Lights (Karaoke Version)', 'harbor lights', ['karaoke']],
    ["Harbor Lights (Taylor's Version)", 'harbor lights', ['re-recording']],
    ['Harbor Lights (Clean)', 'harbor lights', ['clean-edit']],
    ['Harbor Lights - Club Mix', 'harbor lights', ['remix']],
  ])('reads %s', (title, base, flags) => {
    const parsed = parseTitle(title);
    expect(parsed.base).toBe(base);
    expect(parsed.flags).toEqual(flags);
  });

  it.each(['Live Forever', 'Clean', 'Remix to the Harbor', 'Time (You and I)'])('leaves %s as a title', (title) => {
    expect(parseTitle(title).flags).toEqual([]);
  });

  it('compares across accents and case', () => {
    expect(parseTitle('TITÍ me preguntó').base).toBe(parseTitle('Tití Me Preguntó').base);
  });
});

describe('recording identity', () => {
  const identity = { title: 'Harbor Lights', primaryArtist: 'The Paper Lanterns', durationMs: 214_000, explicit: 'not-explicit' as const, versionFlags: [] };

  it('gives every install the same ID for a recording', async () => {
    expect(await recordingId(identity)).toBe(await recordingId({ ...identity, title: 'HARBOR LIGHTS' }));
  });

  it('shares an ID across reissues that differ by a second', async () => {
    expect(await recordingId(identity)).toBe(await recordingId({ ...identity, durationMs: 213_000 }));
  });

  it.each([
    ['a live version', { versionFlags: ['live' as const] }],
    ['a remaster', { versionFlags: ['remaster' as const] }],
    ['an explicit release', { explicit: 'explicit' as const }],
    ['a song with one name but another length', { durationMs: 300_000 }],
    ['another artist', { primaryArtist: 'Mira Vale' }],
  ])('separates %s', async (_name, change) => {
    expect(await recordingId(identity)).not.toBe(await recordingId({ ...identity, ...change }));
  });

  it('stays a valid UUID', async () => {
    expect(await recordingId(identity)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('matching', () => {
  it('accepts the same recording and says why', () => {
    const outcome = statusFor(target(), [row()]);
    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') return;
    const signals = outcome.accepted.evidence.map((item) => item.signal);
    expect(signals).toEqual(expect.arrayContaining(['title-match', 'artist-match', 'duration-match', 'official-audio']));
  });

  // The doc 06 acceptance line: none of these may stand in for the studio recording.
  it.each([
    ['live', 'Harbor Lights (Live at the Quay)'],
    ['remix', 'Harbor Lights (Night Remix)'],
    ['clean', 'Harbor Lights (Clean)'],
    ['karaoke', 'Harbor Lights (Karaoke Version)'],
    ['tribute', 'Harbor Lights (Tribute to The Paper Lanterns)'],
    ['acoustic', 'Harbor Lights (Acoustic)'],
    ['instrumental', 'Harbor Lights (Instrumental)'],
    ['unbracketed cover', 'Harbor Lights piano cover'],
  ])('rejects a %s at the same length', (_name, title) => {
    expect(statusFor(target(), [row({ title })]).status).toBe('no-match');
  });

  it('rejects a cover by another artist at the same length', () => {
    expect(statusFor(target(), [row({ artists: ['Mira Vale'] })]).status).toBe('no-match');
  });

  it('rejects the same title at a very different length', () => {
    expect(statusFor(target(), [row({ durationMs: 400_000 })]).status).toBe('no-match');
  });

  it('rejects a studio recording when the live one was asked for', () => {
    expect(statusFor(target({ title: 'Harbor Lights (Live at the Quay)' }), [row()]).status).toBe('no-match');
  });

  it('rejects the original when the re-recording was asked for, and the reverse', () => {
    const original = row();
    const reRecorded = row({ title: "Harbor Lights (Taylor's Version)" });
    expect(statusFor(target({ title: "Harbor Lights (Taylor's Version)" }), [original]).status).toBe('no-match');
    expect(statusFor(target(), [reRecorded]).status).toBe('no-match');
  });

  it('takes a remaster only below the original, because it is the same performance', () => {
    const scoredOriginal = scoreRow(target(), row());
    const scoredRemaster = scoreRow(target(), row({ title: 'Harbor Lights - 2018 Remaster' }));
    expect(scoredRemaster.rejected).toBe(false);
    expect(scoredRemaster.confidence).toBeLessThan(scoredOriginal.confidence);
    expect(statusFor(target(), [row({ title: 'Harbor Lights - 2018 Remaster' })]).status).toBe('matched');
  });

  it('prefers label audio over an official video', () => {
    const outcome = statusFor(target(), [row({ sourceId: 'video', kind: 'official-video' }), row({ sourceId: 'audio' })]);
    expect(outcome.status === 'matched' && outcome.accepted.row.sourceId).toBe('audio');
  });

  it('does not accept an official video on title alone, because its cut may differ', () => {
    const outcome = statusFor(target({ durationMs: 0 }), [row({ kind: 'official-video' })]);
    expect(outcome.status).toBe('no-match');
  });

  it('tells live performances apart by name', () => {
    const wanted = target({ title: 'Harbor Lights (Live at the Quay)', durationMs: 0 });
    const outcome = statusFor(wanted, [
      row({ sourceId: 'other', title: 'Harbor Lights (Live in Lisbon)' }),
      row({ sourceId: 'quay', title: 'Harbor Lights (Live at the Quay)' }),
    ]);
    expect(outcome.status === 'matched' && outcome.accepted.row.sourceId).toBe('quay');
  });

  it('asks when two different cuts fit equally well', () => {
    const outcome = statusFor(target({ durationMs: 0 }), [row({ sourceId: 'a', title: 'Harbor Lights - 2018 Remaster' }), row({ sourceId: 'b', title: 'Harbor Lights (Radio Edit)' })]);
    expect(outcome.status).toBe('ambiguous');
  });

  it('treats the same recording on two releases as a spare, not a choice', () => {
    const outcome = statusFor(target(), [row({ sourceId: 'album', album: 'Harbor Lights' }), row({ sourceId: 'best-of', album: 'Best Of' })]);
    expect(outcome.status).toBe('matched');
  });

  it('keeps provider rank between label releases when no duration can separate them', () => {
    const outcome = statusFor(target({ durationMs: 0 }), [row({ sourceId: 'first', durationMs: 214_000 }), row({ sourceId: 'second', durationMs: 275_000 })]);
    expect(outcome.status === 'matched' && outcome.accepted.row.sourceId).toBe('first');
  });

  describe('explicit status', () => {
    const explicit = row({ sourceId: 'explicit', explicit: 'explicit' });
    const clean = row({ sourceId: 'clean', explicit: 'not-explicit' });

    it('takes the explicit release when the track does not say, keeps the clean one, and says so', () => {
      const outcome = statusFor(target(), [clean, explicit]);
      expect(outcome.status).toBe('matched');
      if (outcome.status !== 'matched') return;
      expect(outcome.accepted.row.sourceId).toBe('explicit');
      expect(outcome.alternatives.map((item) => item.row.sourceId)).toEqual(['clean']);
      expect(outcome.accepted.evidence.map((item) => item.detail)).toContain('Explicit release chosen because the track does not say which it is');
    });

    it('follows the track when it does say', () => {
      for (const [status, expected] of [['explicit', 'explicit'], ['not-explicit', 'clean']] as const) {
        const outcome = statusFor(target({ explicit: status }), [clean, explicit]);
        expect(outcome.status === 'matched' && outcome.accepted.row.sourceId).toBe(expected);
      }
    });
  });

  it('reports no results as its own reason', () => {
    const outcome = statusFor(target(), []);
    expect(outcome.status === 'no-match' && outcome.reasons[0]?.signal).toBe('no-results');
  });

  it('explains a no-match', () => {
    const outcome = statusFor(target(), [row({ artists: ['Mira Vale'] })]);
    expect(outcome.status === 'no-match' && outcome.reasons.map((item) => item.signal)).toContain('artist-mismatch');
  });

  it('ignores an artist name repeated in an upload title', () => {
    expect(statusFor(target(), [row({ title: 'The Paper Lanterns - Harbor Lights (Official Video)' })]).status).toBe('matched');
  });
});
