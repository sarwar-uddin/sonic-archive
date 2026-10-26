import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError } from './errors.ts';
import { isSameOrInside } from './path-utils.ts';
import type { Env } from './paths.ts';

/** Repo-local directory holding synthetic audio fixtures. */
export const TEST_FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../../test-fixtures');

/**
 * Checks the real process environment as well as an injected one, so a test
 * cannot switch the sandbox off by passing a hand-built `env`.
 */
export function isTestRuntime(env: Env = {}): boolean {
  return (
    process.env.VITEST !== undefined || process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test'
  );
}

/** Directories a library root may live in while tests run. */
export function testSandboxDirs(): string[] {
  return [os.tmpdir(), TEST_FIXTURES_DIR];
}

/**
 * Under test, throws unless `root` is inside the sandbox; a no-op otherwise.
 * Called both when loading config and when opening a library reader, so
 * neither path can reach a real collection from a test.
 */
export function assertInsideTestSandbox(root: string, env: Env = {}): void {
  if (!isTestRuntime(env)) return;
  const real = fs.realpathSync.native(root);
  const allowed = testSandboxDirs().map((d) => fs.realpathSync.native(d));
  if (!allowed.some((dir) => isSameOrInside(dir, real))) {
    throw new ConfigError(
      'ROOT_OUTSIDE_TEST_SANDBOX',
      `Under test, the library root must be inside one of: ${allowed.join(', ')} (got ${real}).`,
    );
  }
}
