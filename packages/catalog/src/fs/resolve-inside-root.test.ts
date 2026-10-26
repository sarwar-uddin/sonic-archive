import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFixtureLibrary, type LibraryCopy } from '../testing/fixtures.ts';
import { type PathSafetyCode, resolveInsideRoot } from './resolve-inside-root.ts';

let lib: LibraryCopy;

beforeEach(() => {
  lib = copyFixtureLibrary();
});

afterEach(() => {
  lib.cleanup();
});

function expectCode(relPath: string, code: PathSafetyCode): void {
  expect(() => resolveInsideRoot(lib.root, relPath)).toThrowError(
    expect.objectContaining({ name: 'PathSafetyError', code }),
  );
}

describe('resolveInsideRoot', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInsideRoot(lib.root, 'Untagged/unknown.flac')).toBe(
      path.join(lib.root, 'Untagged/unknown.flac'),
    );
    expect(resolveInsideRoot(lib.root, '')).toBe(lib.root);
    expect(resolveInsideRoot(lib.root, 'Untagged/../Drift')).toBe(path.join(lib.root, 'Drift'));
  });

  it.each(['..', '../outside', 'Drift/../../outside', 'Drift/../../library-evil'])(
    'rejects traversal: %s',
    (relPath) => expectCode(relPath, 'ESCAPES_ROOT'),
  );

  it('rejects absolute paths and NUL bytes', () => {
    expectCode('/etc/passwd', 'INVALID_PATH');
    expectCode(path.join(lib.root, 'Drift'), 'INVALID_PATH');
    expectCode('Drift\0/x', 'INVALID_PATH');
  });

  it('rejects symlinks that resolve outside the root', () => {
    fs.writeFileSync(path.join(lib.outside, 'secret.flac'), 'x');
    fs.symlinkSync(lib.outside, path.join(lib.root, 'out-dir'));
    fs.symlinkSync(path.join(lib.outside, 'secret.flac'), path.join(lib.root, 'out.flac'));
    expectCode('out-dir/secret.flac', 'SYMLINK_ESCAPE');
    expectCode('out.flac', 'SYMLINK_ESCAPE');
  });

  it('allows symlinks that stay inside the root', () => {
    fs.symlinkSync(path.join(lib.root, 'Drift'), path.join(lib.root, 'drift-link'));
    expect(resolveInsideRoot(lib.root, 'drift-link')).toBe(path.join(lib.root, 'drift-link'));
  });

  it('reports missing paths', () => {
    expectCode('Nope/none.flac', 'NOT_FOUND');
  });
});
