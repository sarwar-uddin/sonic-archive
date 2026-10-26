import path from 'node:path';
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
 */
export function editionFromPath(relPath: string): string[] {
  const dir = albumFolder(relPath);
  const base = path.basename(dir);
  const names = /^\s*[([{]/.test(base) ? [path.basename(path.dirname(dir)), base] : [base];
  const groups: string[] = [];
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
