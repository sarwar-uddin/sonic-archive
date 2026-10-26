/**
 * Rules for the scanned artwork that collectors keep next to a rip: the
 * front, booklet pages, back, inlay, disc, OBI strip, and so on. Pure: the
 * scanner and the read model pass in names, these rules sort them out.
 *
 * Kinds are derived from names when the catalog is read, not stored, so an
 * improved rule applies without rescanning.
 */
import path from 'node:path';
import type { ScanKind } from '@sonic-archive/contracts';
import { nameTokens } from './folder-art.ts';

export type { ScanKind };

/** In viewing order: the way you would leaf through the case. */
export const SCAN_KINDS = [
  'front',
  'booklet',
  'inside',
  'back',
  'tray',
  'disc',
  'obi',
  'extra',
  'spectrogram',
] as const satisfies readonly ScanKind[];

/** Checked in this order: "Cover-In" is the inside, "CD1 front" the disc. */
const KIND_WORDS: readonly [ScanKind, ReadonlySet<string>][] = [
  ['spectrogram', new Set(['spectrogram', 'spectrum', 'spectral', 'spectro', 'spek'])],
  ['obi', new Set(['obi'])],
  [
    'back',
    new Set([
      'back',
      'backcover',
      'backfolder',
      'rear',
      'reverse',
      'trasera',
      'contraportada',
      'retro',
    ]),
  ],
  ['inside', new Set(['inside', 'inner', 'interior', 'in', 'inlay', 'insert'])],
  ['tray', new Set(['tray', 'traycard', 'jewel', 'case', 'caja'])],
  ['disc', new Set(['cd', 'cdm', 'disc', 'disk', 'matrix', 'mx', 'label'])],
  [
    'front',
    new Set([
      'folder',
      'cover',
      'front',
      'portada',
      'frente',
      'delantera',
      'copertina',
      'couverture',
      'albumart',
    ]),
  ],
  [
    'booklet',
    new Set(['booklet', 'book', 'jbook', 'libreto', 'folleto', 'livret', 'libretto', 'page']),
  ],
  [
    'extra',
    new Set([
      'sticker',
      'postcard',
      'poster',
      'digipak',
      'digipack',
      'digi',
      'sleeve',
      'sleeves',
      'slipcase',
      'photo',
      'photos',
      'extras',
    ]),
  ],
];

export interface ScanInfo {
  readonly kind: ScanKind;
  /** First number in the name ("Booklet 07" → 7), for page order. */
  readonly number: number | null;
  /** The file name without extension, for captions. */
  readonly label: string;
}

/**
 * Classifies one image by its file name, then by its folder ("Booklet/03.jpg",
 * "photos/IMG_1.jpg"). Numbered names that say nothing else ("01.jpg",
 * "Scan_4") are booklet pages; anything else unrecognized is an extra.
 */
export function classifyScan(relPath: string): ScanInfo {
  const base = path.basename(relPath);
  const tokens = nameTokens(base);
  const folderTokens = nameTokens(path.basename(path.dirname(relPath)));
  const numberToken = tokens.find((t) => /^\d+$/.test(t));
  const number = numberToken === undefined ? null : Number(numberToken);
  const kind = kindOf(tokens) ?? kindOf(folderTokens) ?? (number !== null ? 'booklet' : 'extra');
  return {
    kind,
    number,
    label: path.basename(base, path.extname(base)).replace(/_/g, ' ').trim(),
  };
}

function kindOf(tokens: readonly string[]): ScanKind | null {
  for (const [kind, words] of KIND_WORDS) {
    if (
      tokens.some((t) => words.has(t) || [...words].some((w) => w.length >= 5 && t.startsWith(w)))
    ) {
      return kind;
    }
  }
  // Scanner shorthand: "f.jpg", "Longbox b.jpg".
  const last = tokens.at(-1);
  return last === 'f' ? 'front' : last === 'b' ? 'back' : null;
}

/** Sorts scans into viewing order: by kind, then page number, then name. */
export function compareScans(a: string, b: string): number {
  const x = classifyScan(a);
  const y = classifyScan(b);
  return (
    SCAN_KINDS.indexOf(x.kind) - SCAN_KINDS.indexOf(y.kind) ||
    (x.number ?? Number.MAX_SAFE_INTEGER) - (y.number ?? Number.MAX_SAFE_INTEGER) ||
    a.localeCompare(b, 'en', { numeric: true })
  );
}

/**
 * Whether to look for scans inside a subfolder of an album folder, given
 * its sibling folders. Skipped: a "Low-Res" set next to a "Hi-Res" one, and
 * "ALT 600 dpi"-style alternate scans, both of which repeat the main set.
 * (The scanner separately skips folders that hold other albums' audio.)
 */
export function isScanFolder(name: string, siblings: readonly string[]): boolean {
  if (name.startsWith('.')) return false;
  if (/^low[\s_-]*res/i.test(name) && siblings.some((s) => /^hi[\s_-]*res/i.test(s))) {
    return false;
  }
  return !/^(alt|alternate)\b/i.test(name);
}

/** Most scans an album gathers; a deeper "photos" dump is cut off here. */
export const MAX_SCANS_PER_ALBUM = 200;

/** How many folder levels below the album folder are searched. */
export const MAX_SCAN_DEPTH = 3;
