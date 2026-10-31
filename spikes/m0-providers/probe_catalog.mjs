// Live provider probe for metadata, artwork, lyrics and permitted-content fallbacks.
// Dependency-free on purpose: `node spikes/m0-providers/probe_catalog.mjs`.
// Not a CI test. A failure here means a provider failed, not that app code is broken.
//
// results/ is committed to a public repo, so it holds measurements only: no lyrics,
// no third-party titles or artwork, and no signed URLs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const USER_AGENT = 'fyspoti-spike/0.0.1 (https://github.com/ecrystell/fyspoti)';
const MB_GAP_MS = 1200; // MusicBrainz allows 1 request per second per IP.
const QUEEN_MBID = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3';
const REJECT_WORDS = ['cover', 'karaoke', 'tribute', 'instrumental', 'remix', 'acoustic', 'piano', 'lullaby', "taylor's version", 'made famous', 'originally performed', 'in the style of'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (text) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

async function get(url, { headers = {}, json = true } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const body = json ? await response.json().catch(() => null) : null;
    return { status: response.status, ms: Math.round(performance.now() - started), body, headers: response.headers };
  } catch (error) {
    return { status: 0, ms: Math.round(performance.now() - started), body: null, error: String(error.message ?? error) };
  }
}

// A deliberately plain acceptance check. Real scoring is task 7; this only asks
// whether the provider surfaced the labeled recording at all.
function accepts(label, { title, artists, durationS, extra = '' }) {
  const haystack = normalize(`${title} ${extra}`);
  if (!haystack.includes(normalize(label.title))) return false;
  if (!artists.some((artist) => label.artists.some((name) => normalize(artist).includes(normalize(name))))) return false;
  if (durationS == null || Math.abs(durationS - label.durationS) > 5) return false;
  if (label.requireWords && !label.requireWords.every((word) => haystack.includes(word))) return false;
  if (['studio', 'remaster', 'radio-edit'].includes(label.variant)) {
    if (REJECT_WORDS.some((word) => haystack.includes(normalize(word)))) return false;
    if (/\blive\b/.test(haystack)) return false;
  }
  return true;
}

const rankOf = (label, rows) => {
  const index = rows.findIndex((row) => accepts(label, row));
  return index === -1 ? null : index + 1;
};

// Free text is what a user types; structured is what we control when matching.
// Both are measured because they behave very differently on MusicBrainz.
const freeTextQuery = (label) => label.query ?? `${label.artists[0]} ${label.title}`;
const structuredQuery = (label) => `recording:"${label.title}" AND artist:"${label.artists[0]}"`;

async function probeMusicBrainz(labels, buildQuery) {
  const rows = [];
  for (const label of labels) {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(buildQuery(label))}&limit=25&fmt=json`;
    let result = await get(url);
    if (result.status !== 200) {
      await sleep(MB_GAP_MS * 2);
      result = await get(url);
    }
    const hits = (result.body?.recordings ?? []).map((recording) => ({
      title: recording.title,
      artists: (recording['artist-credit'] ?? []).map((credit) => credit.name),
      durationS: recording.length ? Math.round(recording.length / 1000) : null,
      extra: recording.disambiguation ?? '',
      isrcs: recording.isrcs ?? [],
    }));
    const rank = rankOf(label, hits);
    rows.push({ id: label.id, status: result.status, error: result.error, ms: result.ms, rank, hasIsrc: rank ? hits[rank - 1].isrcs.length > 0 : null });
    await sleep(MB_GAP_MS);
  }
  return rows;
}

async function probeDeezer(labels) {
  const rows = [];
  for (const label of labels) {
    const result = await get(`https://api.deezer.com/search?q=${encodeURIComponent(freeTextQuery(label))}&limit=25`);
    const hits = (result.body?.data ?? []).map((track) => ({ title: track.title, artists: [track.artist?.name ?? ''], durationS: track.duration, extra: track.title_version ?? '', isrc: track.isrc }));
    const rank = rankOf(label, hits);
    rows.push({ id: label.id, status: result.status, ms: result.ms, rank, hasIsrc: rank ? Boolean(hits[rank - 1].isrc) : null });
    await sleep(250);
  }
  return rows;
}

async function probeMusicBrainzDetails() {
  const out = {};
  const isrc = await get('https://musicbrainz.org/ws/2/isrc/GBUM71029604?inc=artist-credits+releases&fmt=json');
  const recording = isrc.body?.recordings?.[0];
  out.isrcLookup = { status: isrc.status, ms: isrc.ms, recordingId: recording?.id, lengthMs: recording?.length };
  await sleep(MB_GAP_MS);

  // Page twice over the same query. Offsets have to hide behind an opaque cursor,
  // so overlap between pages is what the contract has to tolerate.
  const pageUrl = (offset) => `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent('recording:"Bohemian Rhapsody" AND artist:queen')}&limit=25&offset=${offset}&fmt=json`;
  const first = await get(pageUrl(0));
  await sleep(MB_GAP_MS);
  const second = await get(pageUrl(25));
  await sleep(MB_GAP_MS);
  const firstIds = new Set((first.body?.recordings ?? []).map((row) => row.id));
  const secondIds = (second.body?.recordings ?? []).map((row) => row.id);
  out.pagination = { status: [first.status, second.status], total: first.body?.count, overlap: secondIds.filter((id) => firstIds.has(id)).length, pageSizes: [firstIds.size, secondIds.length] };

  const releases = await get(`https://musicbrainz.org/ws/2/release-group?artist=${QUEEN_MBID}&type=album&limit=100&fmt=json`);
  const groups = releases.body?.['release-groups'] ?? [];
  const group = groups.find((item) => item.title === 'A Night at the Opera') ?? groups[0];
  out.discography = { status: releases.status, total: releases.body?.['release-group-count'] };
  await sleep(MB_GAP_MS);

  out.coverArt = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const art = await get(`https://coverartarchive.org/release-group/${group?.id}/front-500`, { json: false });
    out.coverArt.push({ status: art.status, ms: art.ms, type: art.headers?.get('content-type') });
    await sleep(MB_GAP_MS);
  }
  return out;
}

// Lyric text is copyrighted, so only its presence is recorded.
async function probeLyrics(labels) {
  const rows = [];
  for (const label of labels) {
    const params = new URLSearchParams({ track_name: label.title, artist_name: label.artists[0], duration: String(label.durationS) });
    let result = await get(`https://lrclib.net/api/get?${params}`);
    if (result.status >= 500) {
      await sleep(1500);
      result = await get(`https://lrclib.net/api/get?${params}`);
    }
    rows.push({ id: label.id, status: result.status, ms: result.ms, synced: Boolean(result.body?.syncedLyrics), plain: Boolean(result.body?.plainLyrics) });
    await sleep(350);
  }
  return rows;
}

async function checkRange(url) {
  const result = await get(url, { headers: { Range: 'bytes=65536-66559' }, json: false });
  return { status: result.status, type: result.headers?.get('content-type'), contentRange: result.headers?.get('content-range') };
}

async function probeAudius() {
  const out = {};
  const search = await get('https://api.audius.co/v1/tracks/trending?limit=25');
  const usable = (search.body?.data ?? []).filter((track) => track.is_streamable && !track.is_stream_gated);
  const verified = usable.filter((track) => track.user?.is_verified);
  const track = verified[0] ?? usable[0];
  out.search = { status: search.status, ms: search.ms, returned: search.body?.data?.length ?? 0, streamable: usable.length, verifiedUploader: verified.length, downloadable: usable.filter((t) => t.is_downloadable && !t.is_download_gated).length, withIsrc: usable.filter((t) => t.isrc).length };
  out.stream = track ? await checkRange(`https://api.audius.co/v1/tracks/${track.id}/stream`) : null;

  // Mainstream titles on an open-upload service are the rip hazard: a search hit
  // is never evidence that the uploader holds rights to the recording.
  const hazard = await get(`https://api.audius.co/v1/tracks/search?query=${encodeURIComponent('Queen Bohemian Rhapsody')}&limit=20`);
  const rows = hazard.body?.data ?? [];
  out.mainstreamHazard = { returned: rows.length, verifiedUploader: rows.filter((t) => t.user?.is_verified).length, withinTwoSecondsOfStudio: rows.filter((t) => Math.abs(t.duration - 355) <= 2).length, withIsrc: rows.filter((t) => t.isrc).length };
  return out;
}

async function probeInternetArchive() {
  const out = {};
  // The search index rejects slashes in wildcards, so licenses are narrowed client-side.
  const query = 'mediatype:audio AND collection:netlabels AND licenseurl:*creativecommons*';
  const search = await get(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=licenseurl&rows=500&output=json`);
  const rows = search.body?.response?.docs ?? [];
  const docs = rows.filter((doc) => /licenses\/(by|by-sa)\/|publicdomain\/zero/.test(doc.licenseurl ?? ''));
  out.search = { status: search.status, ms: search.ms, numFound: search.body?.response?.numFound ?? 0, sampled: rows.length, reuseFriendlyInSample: docs.length };
  for (const doc of docs) {
    const metadata = await get(`https://archive.org/metadata/${doc.identifier}`);
    const file = (metadata.body?.files ?? []).find((item) => /\.mp3$/i.test(item.name));
    if (!file) continue;
    out.item = { identifier: doc.identifier, licenseurl: doc.licenseurl };
    out.stream = await checkRange(`https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`);
    break;
  }
  return out;
}

async function probeBrowse() {
  const count = (body, path) => {
    const value = path.reduce((node, key) => node?.[key], body);
    return Array.isArray(value) ? value.length : 0;
  };
  const endpoints = {
    deezerCharts: ['https://api.deezer.com/chart/0/tracks?limit=10', ['data']],
    deezerNewReleases: ['https://api.deezer.com/editorial/0/releases?limit=10', ['data']],
    deezerGenres: ['https://api.deezer.com/genre', ['data']],
    deezerRelatedArtists: ['https://api.deezer.com/artist/412/related?limit=10', ['data']],
    deezerArtistRadio: ['https://api.deezer.com/artist/412/radio?limit=10', ['data']],
    listenBrainzTopRecordings: [`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${QUEEN_MBID}`, []],
    listenBrainzFreshReleases: ['https://api.listenbrainz.org/1/explore/fresh-releases/?days=7', ['payload', 'releases']],
    listenBrainzSitewideArtists: ['https://api.listenbrainz.org/1/stats/sitewide/artists?count=10', ['payload', 'artists']],
  };
  const out = {};
  for (const [name, [url, path]] of Object.entries(endpoints)) {
    const result = await get(url);
    out[name] = { status: result.status, ms: result.ms, items: count(result.body, path) };
    await sleep(300);
  }
  return out;
}

const summarize = (rows) => {
  const found = rows.filter((row) => row.rank != null);
  const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
  return {
    total: rows.length,
    foundInTop25: found.length,
    top1: found.filter((row) => row.rank === 1).length,
    top5: found.filter((row) => row.rank <= 5).length,
    withIsrc: found.filter((row) => row.hasIsrc).length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    maxMs: sorted.at(-1),
    errors: rows.filter((row) => row.status !== 200).length,
  };
};

async function main() {
  const labels = JSON.parse(await readFile(new URL('recordings.json', here), 'utf8'));
  const musicbrainzFreeText = await probeMusicBrainz(labels, freeTextQuery);
  const musicbrainz = await probeMusicBrainz(labels, structuredQuery);
  const deezer = await probeDeezer(labels);
  const lyrics = await probeLyrics(labels);
  const report = {
    ranAt: new Date().toISOString(),
    summary: {
      musicbrainzFreeText: summarize(musicbrainzFreeText),
      musicbrainzStructured: summarize(musicbrainz),
      deezer: summarize(deezer),
      lyrics: { total: lyrics.length, synced: lyrics.filter((row) => row.synced).length, plainOnly: lyrics.filter((row) => row.plain && !row.synced).length, missing: lyrics.filter((row) => !row.plain && !row.synced).length, serverErrors: lyrics.filter((row) => row.status >= 500).length },
    },
    musicbrainzDetails: await probeMusicBrainzDetails(),
    audius: await probeAudius(),
    internetArchive: await probeInternetArchive(),
    browse: await probeBrowse(),
    musicbrainzFreeText,
    musicbrainz,
    deezer,
    lyrics,
  };
  await mkdir(new URL('results/', here), { recursive: true });
  await writeFile(new URL('results/catalog.json', here), `${JSON.stringify(report, null, 2)}\n`);
  const { summary, musicbrainzDetails, audius, internetArchive, browse } = report;
  console.log(JSON.stringify({ summary, musicbrainzDetails, audius, internetArchive, browse }, null, 2));
}

await main();
