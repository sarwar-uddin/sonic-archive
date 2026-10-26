import path from 'node:path';

/** Image types accepted as cover sources. TIFF scans are converted for display. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
]);

/** Subfolders where rippers and scanners commonly put artwork. */
export const ART_SUBFOLDERS: ReadonlySet<string> = new Set([
  'artwork',
  'artworks',
  'art',
  'covers',
  'cover',
  'scans',
  'scan',
  'images',
  'booklet',
  'look',
]);

/** Words meaning "front cover", in the languages that show up in rips. */
const FRONT_WORDS = new Map([
  ['folder', 100],
  ['cover', 100],
  ['front', 100],
  ['portada', 95], // es
  ['frente', 90], // es/pt
  ['delantera', 90], // es
  ['copertina', 95], // it
  ['couverture', 95], // fr
  ['albumart', 90],
  ['album', 70],
]);

/** Words that mark something other than the front cover. */
const NOT_FRONT = new Set([
  'back',
  'rear',
  'inlay',
  'inside',
  'in',
  'inner',
  'interior',
  'tray',
  'cd',
  'disc',
  'disk',
  'label',
  'matrix',
  'spine',
  'obi',
  'reverse',
  'contraportada',
  'trasera',
  'retro',
]);

/** A trailing page number of 0 or 1 ("Scan_1", "Booklet 01", "Libreto_00"). */
const FIRST_PAGE = /^0*[01]$/;

/**
 * Splits a file name into lowercase words, also between letters and digits,
 * so "Libreto_00Portada" gives ["libreto", "00", "portada"].
 */
export function nameTokens(fileName: string): string[] {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+|(?<=\p{N})(?=\p{L})|(?<=\p{L})(?=\p{N})/u)
    .filter(Boolean);
}

/**
 * How likely an image is to be the front cover; 0 means "never choose".
 * Front words score highest, lowered by words like "back" or "cd"
 * ("cd1 funda delantera" is a disc sleeve, not the album cover). Lower
 * numbers win among siblings ("cover 1" beats "cover 2"). Failing names,
 * the first page of a scan set ("Scan_1", "Booklet 01") is a weak fallback.
 */
export function coverScore(fileName: string): number {
  const tokens = nameTokens(fileName);
  let score = Math.max(0, ...tokens.map((t) => FRONT_WORDS.get(t) ?? 0));
  const negative = tokens.some((t) => NOT_FRONT.has(t));
  const number = tokens.find((t) => /^\d+$/.test(t));

  if (score > 0) {
    if (negative) score -= 60;
    if (number !== undefined) score -= Math.min(Number(number), 9);
  } else if (!negative && number !== undefined && FIRST_PAGE.test(number)) {
    score = 20;
  }
  return Math.max(0, score);
}

/**
 * Picks the album cover among image files found in an album folder.
 * `candidates` are relative to that folder ("folder.jpg",
 * "Artwork/Front.png"). Files in the folder itself get a small bonus over
 * files in art subfolders. Returns null if nothing looks like a cover.
 */
export function chooseFolderArtwork(candidates: readonly string[]): string | null {
  let best: { path: string; score: number } | null = null;
  for (const candidate of candidates) {
    if (!IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;
    const depth = candidate.split(/[\\/]/).length - 1;
    if (depth > 1) continue;
    const base = coverScore(candidate);
    if (base === 0) continue;
    const score = base + (depth === 0 ? 10 : 0);
    // Ties resolve by name, for a stable choice.
    if (!best || score > best.score || (score === best.score && candidate < best.path)) {
      best = { path: candidate, score };
    }
  }
  return best?.path ?? null;
}
