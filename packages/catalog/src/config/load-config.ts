import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.ts';
import { type AppDirs, type Env, resolveAppDirs } from './paths.ts';
import { isTestRuntime, testSandboxDirs } from './sandbox.ts';
import { validateLibraryRoot } from './validate-root.ts';

export type LibraryConfig =
  | { readonly status: 'unconfigured' }
  | {
      readonly status: 'configured';
      readonly root: string;
      /** `env`: SONIC_LIBRARY_ROOT, which the app cannot change; `file`: config.json. */
      readonly source: 'env' | 'file';
    };

export interface AppSettings {
  /** Follow changes in the library while the app runs (default on). */
  readonly watch: boolean;
}

export interface AppConfig {
  readonly dirs: AppDirs;
  readonly library: LibraryConfig;
  readonly settings: AppSettings;
}

export interface LoadConfigOptions {
  readonly env: Env;
  readonly homeDir: string;
}

export const CONFIG_FILE_NAME = 'config.json';

const configFileSchema = z.strictObject({
  libraryRoot: z.string().min(1).optional(),
  watch: z.boolean().optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

/**
 * Loads and validates configuration. Throws `ConfigError` on anything unsafe.
 *
 * The library root comes from `SONIC_LIBRARY_ROOT` or the config file, which
 * the app's folder picker writes (`saveConfig`) after the same validation.
 * An absent root is a valid state: the app asks for a folder on first run.
 */
export function loadConfig({ env, homeDir }: LoadConfigOptions): AppConfig {
  const dirs = resolveAppDirs(env, homeDir);
  const file = readConfigFile(path.join(dirs.configDir, CONFIG_FILE_NAME));
  const fromEnv = nonEmpty(env.SONIC_LIBRARY_ROOT);
  const rawRoot = fromEnv ?? file.libraryRoot;
  const settings = { watch: file.watch ?? true };

  if (rawRoot === undefined) {
    return { dirs, library: { status: 'unconfigured' }, settings };
  }

  const root = validateLibraryRoot(rawRoot, rootValidationContext(env, homeDir, dirs));
  return {
    dirs,
    library: { status: 'configured', root, source: fromEnv ? 'env' : 'file' },
    settings,
  };
}

/** The checks a library root must pass, wherever it comes from. */
export function rootValidationContext(env: Env, homeDir: string, dirs: AppDirs) {
  return {
    homeDir,
    appDirs: dirs,
    ...(isTestRuntime(env) && { sandboxDirs: testSandboxDirs() }),
  };
}

/**
 * Updates config.json with `changes`, keeping other fields. Written to a
 * temporary file and renamed, so a crash never leaves a half-written config.
 * Only ever writes inside the app's config directory.
 */
export function saveConfig(configDir: string, changes: Partial<ConfigFile>): void {
  const file = path.join(configDir, CONFIG_FILE_NAME);
  const next = configFileSchema.parse({ ...readConfigFile(file), ...changes });
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
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
