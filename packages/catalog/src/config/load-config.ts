import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.ts';
import { type AppDirs, type Env, resolveAppDirs } from './paths.ts';
import { validateLibraryRoot } from './validate-root.ts';

export type LibraryConfig =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'configured'; readonly root: string };

export interface AppConfig {
  readonly dirs: AppDirs;
  readonly library: LibraryConfig;
}

export interface LoadConfigOptions {
  readonly env: Env;
  readonly homeDir: string;
}

export const CONFIG_FILE_NAME = 'config.json';

const configFileSchema = z.strictObject({
  libraryRoot: z.string().min(1).optional(),
});

/** Repo-local directory holding synthetic audio fixtures. */
const TEST_FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../test-fixtures');

/**
 * Loads and validates configuration. Throws `ConfigError` on anything unsafe.
 *
 * The library root comes only from `SONIC_LIBRARY_ROOT` or the config file,
 * never from an API request. An absent root is a valid state: the app runs
 * with an empty catalog until you configure one.
 */
export function loadConfig({ env, homeDir }: LoadConfigOptions): AppConfig {
  const dirs = resolveAppDirs(env, homeDir);
  const file = readConfigFile(path.join(dirs.configDir, CONFIG_FILE_NAME));
  const rawRoot = nonEmpty(env.SONIC_LIBRARY_ROOT) ?? file.libraryRoot;

  if (rawRoot === undefined) {
    return { dirs, library: { status: 'unconfigured' } };
  }

  const root = validateLibraryRoot(rawRoot, {
    homeDir,
    appDirs: dirs,
    ...(isTestRuntime(env) && { sandboxDirs: [os.tmpdir(), TEST_FIXTURES_DIR] }),
  });
  return { dirs, library: { status: 'configured', root } };
}

/**
 * Checks the real process environment as well as the injected one, so a
 * test cannot switch the sandbox off by passing a hand-built `env`.
 */
function isTestRuntime(env: Env): boolean {
  return (
    process.env.VITEST !== undefined || process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test'
  );
}

function readConfigFile(file: string): z.infer<typeof configFileSchema> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConfigError('INVALID_CONFIG_FILE', `${file} is not valid JSON.`);
  }

  const parsed = configFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConfigError(
      'INVALID_CONFIG_FILE',
      `${file} is invalid:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}
