import path from 'node:path';

/**
 * Where the application keeps its own files. None of these may live inside
 * the music library; `validateLibraryRoot` enforces that.
 */
export interface AppDirs {
  /** Holds `config.json`. */
  readonly configDir: string;
  /** Holds the SQLite database and its backups. */
  readonly dataDir: string;
  /** Holds regenerable artifacts such as extracted artwork. */
  readonly cacheDir: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

const APP_NAME = 'sonic-archive';

/**
 * Resolves application directories following the XDG Base Directory spec,
 * with `SONIC_*` overrides. Pure: the environment and home directory are
 * passed in, so tests never touch the real user directories.
 */
export function resolveAppDirs(env: Env, homeDir: string): AppDirs {
  return {
    configDir: pick(env.SONIC_CONFIG_DIR, xdg(env.XDG_CONFIG_HOME, homeDir, '.config')),
    dataDir: pick(env.SONIC_DATA_DIR, xdg(env.XDG_DATA_HOME, homeDir, '.local/share')),
    cacheDir: pick(env.SONIC_CACHE_DIR, xdg(env.XDG_CACHE_HOME, homeDir, '.cache')),
  };
}

function pick(override: string | undefined, fallback: string): string {
  return nonEmptyAbsolute(override) ?? fallback;
}

function xdg(base: string | undefined, homeDir: string, defaultRel: string): string {
  // The XDG spec says relative values must be ignored.
  const root = nonEmptyAbsolute(base) ?? path.join(homeDir, defaultRel);
  return path.join(root, APP_NAME);
}

function nonEmptyAbsolute(value: string | undefined): string | undefined {
  return value && path.isAbsolute(value) ? path.resolve(value) : undefined;
}
