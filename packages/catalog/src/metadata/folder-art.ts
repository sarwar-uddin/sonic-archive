import path from 'node:path';

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
]);

/** Subfolders where rippers and scanners commonly put artwork. */
export const ART_SUBFOLDERS: ReadonlySet<string> = new Set([
  'artwork',
  'art',
  'covers',
  'cover',
  'scans',
  'images',
]);

/** Accepted cover file names (without extension), most preferred first. */
const COVER_NAMES = ['cover', 'folder', 'front', 'albumart', 'album'];

/**
 * Picks the album cover among image files found in an album folder.
 * `candidates` are paths relative to that folder: `folder.jpg` or
 * `Artwork/Front.png`. Files in the folder itself beat files in art
 * subfolders; within each, the earlier name in COVER_NAMES wins. Anything
 * else (`back.jpg`, `cd.png`, `booklet-01.jpg`) is never chosen.
 */
export function chooseFolderArtwork(candidates: readonly string[]): string | null {
  let best: { path: string; rank: number } | null = null;
  for (const candidate of candidates) {
    const ext = path.extname(candidate).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const nameRank = COVER_NAMES.indexOf(
      path.basename(candidate, path.extname(candidate)).toLowerCase(),
    );
    if (nameRank === -1) continue;
    const depth = candidate.split(/[\\/]/).length - 1;
    if (depth > 1) continue;
    const rank = depth * COVER_NAMES.length + nameRank;
    // Ties (cover.jpg vs cover.png) resolve by name, for a stable choice.
    if (!best || rank < best.rank || (rank === best.rank && candidate < best.path)) {
      best = { path: candidate, rank };
    }
  }
  return best?.path ?? null;
}
