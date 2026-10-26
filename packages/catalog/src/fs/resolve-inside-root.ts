import fs from 'node:fs';
import path from 'node:path';
import { isSameOrInside } from '../config/path-utils.ts';

export type PathSafetyCode =
  | 'INVALID_PATH'
  | 'ESCAPES_ROOT'
  | 'SYMLINK_ESCAPE'
  | 'NOT_FOUND'
  | 'NOT_A_DIRECTORY';

export class PathSafetyError extends Error {
  readonly code: PathSafetyCode;

  constructor(code: PathSafetyCode, message: string) {
    super(message);
    this.name = 'PathSafetyError';
    this.code = code;
  }
}

/**
 * Turns a root-relative path into an absolute path that is guaranteed to be
 * inside `root`, both as written and after resolving symlinks.
 *
 * Every library file access goes through this, even for paths the scanner
 * built itself: a stored path could be stale, or a file could be swapped for
 * a symlink between the walk and the read.
 */
export function resolveInsideRoot(root: string, relPath: string): string {
  if (relPath.includes('\0')) {
    throw new PathSafetyError('INVALID_PATH', 'Path contains a NUL byte.');
  }
  if (path.isAbsolute(relPath)) {
    throw new PathSafetyError('INVALID_PATH', `Expected a root-relative path, got "${relPath}".`);
  }

  const absolute = path.resolve(root, relPath);
  if (!isSameOrInside(root, absolute)) {
    throw new PathSafetyError('ESCAPES_ROOT', `"${relPath}" points outside the library root.`);
  }

  let real: string;
  try {
    real = fs.realpathSync.native(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new PathSafetyError('NOT_FOUND', `"${relPath}" does not exist.`);
    }
    throw error;
  }
  if (!isSameOrInside(fs.realpathSync.native(root), real)) {
    throw new PathSafetyError('SYMLINK_ESCAPE', `"${relPath}" resolves outside the library root.`);
  }
  return absolute;
}
