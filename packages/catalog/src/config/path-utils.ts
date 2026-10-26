import path from 'node:path';

/**
 * True when `child` equals `parent` or lies beneath it. Both must be absolute.
 *
 * Uses `path.relative` instead of `startsWith`, which would wrongly treat
 * `/music-backup` as inside `/music`.
 */
export function isSameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** True when either path contains the other (or they are the same). */
export function pathsOverlap(a: string, b: string): boolean {
  return isSameOrInside(a, b) || isSameOrInside(b, a);
}
