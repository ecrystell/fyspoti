import type { VersionFlag } from '@fyspoti/contracts';

/** Lowercase, no accents or punctuation. Apostrophes close up so "Taylor's" stays one word. */
export const normalizeText = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokens = (text: string): string[] => normalizeText(text).split(' ').filter(Boolean);

// Checked against normalized text, and only in title parts that describe a version,
// because "Live Forever" and "Remix to Ignition" style words can be real titles.
const FLAG_PATTERNS: ReadonlyArray<[VersionFlag, RegExp]> = [
  ['karaoke', /\bkaraoke\b/],
  ['cover', /\bcover\b|\btribute\b|\boriginally performed\b|\bmade famous\b|\bin the style of\b|\blullaby\b/],
  ['live', /\blive\b|\bin concert\b|\bunplugged\b|\bbbc session\b/],
  ['re-recording', /\btaylors version\b|\bre ?record(ed|ing)\b|\bnew recording\b/],
  ['remaster', /\bremaster(ed)?\b|\bstereo mix\b|\bmono\b/],
  ['radio-edit', /\b(radio|single) (edit|version|mix)\b|\bedit$/],
  ['clean-edit', /\bclean\b|\bcensored\b|\bedited\b/],
  ['remix', /\bremix(ed)?\b|\b(club|extended|dub) (mix|version)\b/],
  ['acoustic', /\bacoustic\b/],
  ['instrumental', /\binstrumental\b/],
  ['demo', /\bdemo\b/],
];

// Parts of a title that say nothing about which recording this is.
const NOISE =
  /^(official( music| lyrics?| hd)? (video|audio)|official|music video|lyrics?( video)?|visuali[sz]er|audio|video|hd|hq|4k|\d{4}|(feat|ft|featuring|with|from)\b.*)$/;

// A studio track on these albums is rare, so the album counts as version evidence.
// Narrower than the title patterns: "Live Through This" is not a live album.
const ALBUM_PATTERNS: ReadonlyArray<[VersionFlag, RegExp]> = [
  ['karaoke', /karaoke/i],
  ['cover', /\btribute\b|\blullaby\b|in the style of/i],
  ['live', /\blive (at|in|from|on)\b|[([-]\s*live\b|\bin concert\b|\bunplugged\b/i],
];

const flagsIn = (text: string): VersionFlag[] => FLAG_PATTERNS.flatMap(([flag, pattern]) => (pattern.test(text) ? [flag] : []));

export interface ParsedTitle {
  /** The title without version or noise parts, normalized for comparison. */
  base: string;
  flags: VersionFlag[];
  /** Normalized version wording, such as "live aid", kept to tell live recordings apart. */
  qualifier: string;
}

/** Reads "Song (Live at X)", "Song - Remastered 2009" and "Song [feat. Y]". */
export function parseTitle(title: string): ParsedTitle {
  const parts: string[] = [];
  const main = title
    .replace(/[([]([^()[\]]*)[)\]]/g, (whole, inner: string) => {
      const part = normalizeText(inner);
      if (NOISE.test(part) || flagsIn(part).length > 0) {
        parts.push(part);
        return ' ';
      }
      return whole;
    })
    .split(/\s[-–—]\s/)
    .filter((part, index) => {
      const text = normalizeText(part);
      if (index > 0 && (NOISE.test(text) || flagsIn(text).length > 0)) {
        parts.push(text);
        return false;
      }
      return true;
    })
    .join(' ');

  const versionParts = parts.filter((part) => !NOISE.test(part));
  return {
    base: normalizeText(main),
    flags: [...new Set(versionParts.flatMap(flagsIn))],
    qualifier: versionParts.join(' '),
  };
}

export const albumFlags = (album: string | null | undefined): VersionFlag[] =>
  album ? ALBUM_PATTERNS.flatMap(([flag, pattern]) => (pattern.test(album) ? [flag] : [])) : [];

/** Flags from unbracketed words a title carries beyond the song, as in "Song piano cover". */
export const flagsInWords = (words: string[]): VersionFlag[] => flagsIn(words.join(' '));
