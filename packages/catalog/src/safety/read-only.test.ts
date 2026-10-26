/**
 * Static guard for docs/safety.md #1: code that touches the music library
 * must not contain filesystem write APIs or process spawning.
 *
 * It is a coarse text check, deliberately strict: a false positive costs a
 * moment's thought; a false negative could cost a music collection. Writing
 * to the app's own cache lives in `src/cache/` and is tested separately.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');
const LIBRARY_FACING_DIRS = ['fs', 'scanner', 'metadata'];

const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'fs write/modify call',
    pattern:
      /\b(writeFile|appendFile|rename|unlink|rmdir|rm|mkdir|mkdtemp|copyFile|cp|symlink|link|truncate|ftruncate|chmod|lchmod|fchmod|chown|lchown|fchown|utimes|lutimes|futimes|createWriteStream|write|writev)(Sync)?\s*\(/,
  },
  { name: 'open with a write flag', pattern: /\bopen(Sync)?\s*\([^)]*['"`](w|a|r\+)[^'"`]*['"`]/ },
  { name: 'numeric write flags', pattern: /\bO_(WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/ },
  { name: 'child process', pattern: /\bchild_process\b|\bexecFile\b|\bspawn\s*\(/ },
];

function findViolations(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);
}

function libraryFacingSources(): string[] {
  return LIBRARY_FACING_DIRS.flatMap((dir) =>
    (fs.readdirSync(path.join(SRC, dir), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.join(dir, f)),
  );
}

describe('read-only static guard', () => {
  it('finds the library-facing modules', () => {
    expect(libraryFacingSources()).toEqual(
      expect.arrayContaining([
        path.join('fs', 'library-reader.ts'),
        path.join('fs', 'resolve-inside-root.ts'),
        path.join('scanner', 'scan.ts'),
        path.join('metadata', 'map.ts'),
      ]),
    );
  });

  it.each(libraryFacingSources())('%s contains no write-capable APIs', (file) => {
    expect(findViolations(fs.readFileSync(path.join(SRC, file), 'utf8'))).toEqual([]);
  });

  it.each([
    "fs.writeFileSync(p, 'x')",
    'await fs.promises.rename(a, b)',
    'fs.rmSync(dir, { recursive: true })',
    "await fs.promises.open(p, 'r+')",
    "fs.openSync(p, 'a')",
    'fs.constants.O_WRONLY',
    "import { spawn } from 'node:child_process'",
    'handle.write(buffer)',
    'fs.utimesSync(p, a, m)',
  ])('detects %s', (snippet) => {
    expect(findViolations(snippet)).not.toEqual([]);
  });

  it.each([
    "await fs.promises.open(absolute, 'r')",
    'fs.promises.lstat(p)',
    'fs.realpathSync.native(p)',
    '// fs.writeFileSync(p) in a comment is fine',
  ])('allows %s', (snippet) => {
    expect(findViolations(snippet)).toEqual([]);
  });
});
