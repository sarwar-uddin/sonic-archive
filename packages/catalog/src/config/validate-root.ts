import fs from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors.ts';
import { isSameOrInside, pathsOverlap } from './path-utils.ts';
import type { AppDirs } from './paths.ts';

export interface RootValidationContext {
  readonly homeDir: string;
  readonly appDirs: AppDirs;
  /**
   * When set, the root must lie inside one of these directories. Used under
   * test so that no test can ever be pointed at a real collection.
   */
  readonly sandboxDirs?: readonly string[];
}

/**
 * Checks that a configured library root is a deliberate, narrowly scoped
 * music directory and returns its canonical (symlink-free) absolute path.
 *
 * This inspects only the root directory itself (`realpath` and `stat`). It
 * never lists or reads anything inside the library.
 */
export function validateLibraryRoot(input: string, ctx: RootValidationContext): string {
  if (input.includes('\0')) {
    throw new ConfigError('ROOT_INVALID_CHARACTERS', 'Library root contains a NUL byte.');
  }
  if (!path.isAbsolute(input)) {
    throw new ConfigError(
      'ROOT_NOT_ABSOLUTE',
      `Library root must be an absolute path (got "${input}"). "~" is not expanded.`,
    );
  }

  // Check both the path as written and its canonical form, so a symlink such
  // as ~/music -> ~ cannot smuggle the home directory past the checks.
  const resolved = path.resolve(input);
  assertNotBroad(resolved, ctx.homeDir);

  const canonical = realpathOrThrow(resolved);
  assertNotBroad(canonical, canonicalize(ctx.homeDir));

  if (!fs.statSync(canonical).isDirectory()) {
    throw new ConfigError('ROOT_NOT_DIRECTORY', `Library root is not a directory: ${canonical}`);
  }

  for (const [name, dir] of Object.entries(ctx.appDirs)) {
    const appDir = canonicalize(dir);
    if (pathsOverlap(canonical, appDir) || pathsOverlap(resolved, path.resolve(dir))) {
      throw new ConfigError(
        'ROOT_OVERLAPS_APP_DIR',
        `Library root ${canonical} overlaps the application's ${name} (${appDir}). ` +
          'Application data must live entirely outside the music library.',
      );
    }
  }

  if (ctx.sandboxDirs) {
    const allowed = ctx.sandboxDirs.map(canonicalize);
    if (!allowed.some((dir) => isSameOrInside(dir, canonical))) {
      throw new ConfigError(
        'ROOT_OUTSIDE_TEST_SANDBOX',
        `Under test, the library root must be inside one of: ${allowed.join(', ')} (got ${canonical}).`,
      );
    }
  }

  return canonical;
}

function assertNotBroad(root: string, homeDir: string): void {
  if (path.parse(root).root === root) {
    throw new ConfigError('ROOT_IS_FILESYSTEM_ROOT', 'Library root cannot be the filesystem root.');
  }
  if (isSameOrInside(root, path.resolve(homeDir))) {
    throw new ConfigError(
      'ROOT_IS_HOME_OR_ANCESTOR',
      `Library root ${root} is the home directory or contains it. Point it at the music folder itself.`,
    );
  }
}

function realpathOrThrow(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ConfigError('ROOT_NOT_FOUND', `Library root does not exist: ${p}`);
    }
    throw error;
  }
}

/**
 * Canonical form of a path that may not exist yet (e.g. a data directory
 * before first run): resolve symlinks in the longest existing prefix.
 */
function canonicalize(p: string): string {
  const resolved = path.resolve(p);
  let existing = resolved;
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync.native(existing), ...rest);
}
