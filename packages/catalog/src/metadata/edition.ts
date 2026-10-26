import path from 'node:path';
import { nameKey } from '../text/normalize.ts';
import { albumFolder } from './map.ts';

/** Bracketed groups that only describe the file format, not the pressing. */
const FORMAT_ONLY =
  /^(flac|mp3|ape|wav|lossless|lossy|cd|web|\d+\s*(bit|khz)|v0|320|eac|log|cue|[\s,+/-])+$/i;
const YEAR_ONLY = /^[\s,]*\d{4}([\s,]+\d{4})*[\s,]*$/;

/**
 * Pressing and edition details collectors put in folder names:
 * "1970 Paranoid [1991 Japan TECP-23893 Teichiku]" → ["1991 Japan TECP-23893 Teichiku"],
 * "Mingus Ah Um (1959, 2019, MFSL)" → ["1959, 2019, MFSL"].
 *
 * Reads the bracketed groups of the album folder (and of its parent when the
 * folder is named only by its pressing). Year-only and format-only groups
 * ("(1997)", "[FLAC]") are dropped: they add nothing to what tags already say.
 *
 * Given the album title, a folder below one named after the album, whose own
 * name does not mention it, is taken as a pressing name as a whole:
 * "1986 - Master Of Puppets/1986 Japan 32DP 448 (1st press)" →
 * ["1986 Japan 32DP 448", "1st press"].
 */
export function editionFromPath(relPath: string, albumTitle?: string): string[] {
  const dir = albumFolder(relPath);
  const base = path.basename(dir);
  const parent = path.basename(path.dirname(dir));
  const names = /^\s*[([{]/.test(base) ? [parent, base] : [base];
  const groups: string[] = [];
  if (
    albumTitle !== undefined &&
    !/^\s*[([{]/.test(base) &&
    mentions(parent, albumTitle) &&
    !mentions(base, albumTitle)
  ) {
    const outside = base
      .replace(/[([{][^()[\]{}]*[)\]}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (outside && !YEAR_ONLY.test(outside) && !FORMAT_ONLY.test(outside)) groups.push(outside);
  }
  for (const name of names) {
    for (const match of name.matchAll(/[([{]([^()[\]{}]+)[)\]}]/g)) {
      const text = (match[1] ?? '').trim().replace(/\s+/g, ' ');
      if (text && !YEAR_ONLY.test(text) && !FORMAT_ONLY.test(text) && !groups.includes(text)) {
        groups.push(text);
      }
    }
  }
  return groups;
}

/** Whether a folder name contains the title, ignoring case, accents and punctuation. */
function mentions(folder: string, title: string): boolean {
  const squash = (text: string) => nameKey(text).replace(/[^\p{L}\p{N}]+/gu, '');
  const needle = squash(title);
  return needle !== '' && squash(folder).includes(needle);
}
