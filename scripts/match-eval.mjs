// Live check of recording matching against the labeled set. Not a CI test: a failure
// here can mean YouTube Music failed, not that app code is broken.
//
//   npm run match:eval -- --python path/to/python [--out file] [--set tuning|holdout]
//
// Reads search metadata only. Output is label IDs and counts, with no provider titles,
// so it is safe to commit. Labels come from tests/fixtures/matching/recordings.json.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createCatalog } from '../packages/catalog/dist/index.js';
import { createYtMusicWorker } from '../packages/catalog/dist/youtube/worker-client.js';

const REQUEST_GAP_MS = 400;
const DURATION_TOLERANCE_S = 5;
const WRONG_ON_SHELF = new Set(['live', 'remix', 'cover', 'acoustic', 'instrumental', 'karaoke', 'demo', 're-recording', 'clean-edit']);

const { values } = parseArgs({ options: { python: { type: 'string', default: 'python' }, out: { type: 'string' }, set: { type: 'string' } } });
const here = new URL('.', import.meta.url);
const labels = JSON.parse(await readFile(new URL('../tests/fixtures/matching/recordings.json', here), 'utf8')).filter((label) => !values.set || label.set === values.set);

const worker = createYtMusicWorker({ python: values.python, workerPath: new URL('../services/catalog-worker/worker.py', here).pathname.replace(/^\/(\w:)/, '$1') });

// The accepted candidate only names a source, so the scorer's rows are kept to check it.
const seen = new Map();
const recording = {
  ...worker,
  searchTracks: async (...args) => {
    const rows = await worker.searchTracks(...args);
    for (const row of rows) if (row.videoId) seen.set(row.videoId, row);
    return rows;
  },
};
const catalog = createCatalog({ ytMusic: recording });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const words = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether a chosen source really is the labeled recording, by evidence the scorer did not use alone. */
function isRight(label, candidate, row, withDuration) {
  const flags = new Set(candidate.versionFlags);
  const wanted = new Set(label.flags ?? []);
  if (!(row?.artists ?? []).some((artist) => label.artists.some((name) => words(artist.name ?? '').includes(words(name)) || words(name).includes(words(artist.name ?? ''))))) return false;
  if ((label.flags ?? []).some((flag) => !flags.has(flag))) return false;
  if ((label.notFlags ?? []).some((flag) => flags.has(flag))) return false;
  if ([...flags].some((flag) => WRONG_ON_SHELF.has(flag) && !wanted.has(flag))) return false;
  // Duration is checked even when the matcher was not given it: it is the answer key.
  return Math.abs(candidate.durationMs / 1000 - label.durationS) <= DURATION_TOLERANCE_S || (!withDuration && label.flags === undefined && Math.abs(candidate.durationMs / 1000 - label.durationS) <= 15);
}

async function evaluate(label, withDuration) {
  const hint = { title: label.title, artistNames: label.artists, durationMs: withDuration ? label.durationS * 1000 : 0, ...(label.album ? { album: label.album } : {}) };
  const started = performance.now();
  const result = await catalog.findCandidates(randomUUID(), { hint });
  const ms = Math.round(performance.now() - started);
  await sleep(REQUEST_GAP_MS);
  if (!result.ok) return { id: label.id, set: label.set, outcome: 'error', code: result.error.code, ms };

  const match = result.value;
  if (match.status === 'matched') {
    const right = isRight(label, match.accepted, seen.get(match.accepted.sourceId), withDuration);
    const outcome = label.expect === 'no-match' ? 'false-accept' : right ? 'correct' : label.expect === 'not-wrong' ? 'false-accept' : 'wrong';
    return { id: label.id, set: label.set, outcome, confidence: match.accepted.confidence, flags: match.accepted.versionFlags, durationS: Math.round(match.accepted.durationMs / 1000), ms };
  }
  if (label.expect === 'matched') return { id: label.id, set: label.set, outcome: match.status === 'ambiguous' ? 'asked-user' : 'missed', ms };
  return { id: label.id, set: label.set, outcome: 'correct', status: match.status, ms };
}

const summarize = (rows) => {
  const count = (name) => rows.filter((row) => row.outcome === name).length;
  const ms = rows.map((row) => row.ms).sort((a, b) => a - b);
  return {
    total: rows.length,
    correct: count('correct'),
    askedUser: count('asked-user'),
    missed: count('missed'),
    wrong: count('wrong'),
    falseAccept: count('false-accept'),
    errors: count('error'),
    medianMs: ms[Math.floor(ms.length / 2)],
    maxMs: ms.at(-1),
  };
};

const report = { ranAt: new Date().toISOString(), runs: {} };
try {
  for (const [mode, withDuration] of [['withDuration', true], ['noDuration', false]]) {
    const rows = [];
    for (const label of labels) rows.push(await evaluate(label, withDuration));
    const bySet = Object.fromEntries([...new Set(rows.map((row) => row.set))].map((set) => [set, summarize(rows.filter((row) => row.set === set))]));
    report.runs[mode] = { summary: bySet, failures: rows.filter((row) => row.outcome !== 'correct') };
  }
} finally {
  worker.close();
}

const text = `${JSON.stringify(report, null, 2)}\n`;
if (values.out) await writeFile(values.out, text);
console.log(text);
