/**
 * Test helpers for the synthetic fixture library. Test-only; not exported
 * by the package.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEST_FIXTURES_DIR } from '../config/sandbox.ts';

export const FIXTURE_LIBRARY = path.join(TEST_FIXTURES_DIR, 'library');

/** Audio files the scanner should see in the fixture library (hidden ones excluded). */
export const FIXTURE_AUDIO_COUNT = 17;

export interface LibraryCopy {
  /** Canonical path of the copied library root. */
  readonly root: string;
  /** A sibling directory outside the root, for escape tests. */
  readonly outside: string;
  cleanup(): void;
}

/**
 * Copies the committed fixtures into a fresh temp dir. Tests that modify,
 * delete or lock files do it to this copy, never to `test-fixtures/`.
 */
export function copyFixtureLibrary(): LibraryCopy {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-lib-')));
  const root = path.join(base, 'library');
  const outside = path.join(base, 'outside');
  fs.cpSync(FIXTURE_LIBRARY, root, { recursive: true, preserveTimestamps: true });
  fs.mkdirSync(outside);
  return {
    root,
    outside,
    cleanup() {
      makeWritable(base);
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

export interface FileFingerprint {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
}

/** Hash, size, mtime and mode of every file (hidden ones included). */
export function snapshotTree(root: string): Map<string, FileFingerprint> {
  const out = new Map<string, FileFingerprint>();
  for (const relPath of listFiles(root)) {
    const absolute = path.join(root, relPath);
    const st = fs.lstatSync(absolute);
    out.set(relPath, {
      sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
      size: st.size,
      mtimeMs: st.mtimeMs,
      mode: st.mode,
    });
  }
  return out;
}

/** Removes write permission everywhere under `root` (files 0444, dirs 0555). */
export function makeReadOnly(root: string): void {
  for (const dir of listDirs(root)) fs.chmodSync(path.join(root, dir), 0o555);
  for (const file of listFiles(root)) fs.chmodSync(path.join(root, file), 0o444);
}

/**
 * Restores directory write permission so the tree can be deleted. Files are
 * left alone: removing a file needs a writable directory, not a writable
 * file, and some test files have names that cannot round-trip through a
 * JavaScript string.
 */
export function makeWritable(root: string): void {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, 0o755);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) makeWritable(path.join(root, entry.name));
  }
}

/** Permission tests are meaningless as root, which bypasses file modes. */
export const RUNNING_AS_ROOT = process.getuid?.() === 0;

function listFiles(root: string): string[] {
  return (fs.readdirSync(root, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .sort();
}

function listDirs(root: string): string[] {
  return [
    '',
    ...(fs.readdirSync(root, { recursive: true, withFileTypes: true }) as fs.Dirent[])
      .filter((e) => e.isDirectory())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name))),
  ];
}
