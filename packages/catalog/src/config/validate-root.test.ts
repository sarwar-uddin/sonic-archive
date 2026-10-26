import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigErrorCode } from './errors.ts';
import type { AppDirs } from './paths.ts';
import { type RootValidationContext, validateLibraryRoot } from './validate-root.ts';

let sandbox: string;
let home: string;
let music: string;
let appDirs: AppDirs;

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-root-')));
  home = path.join(sandbox, 'home');
  music = path.join(home, 'Music');
  fs.mkdirSync(music, { recursive: true });
  appDirs = {
    configDir: path.join(home, '.config/sonic-archive'),
    dataDir: path.join(home, '.local/share/sonic-archive'),
    cacheDir: path.join(home, '.cache/sonic-archive'),
  };
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function ctx(overrides: Partial<RootValidationContext> = {}): RootValidationContext {
  return { homeDir: home, appDirs, ...overrides };
}

function expectCode(fn: () => unknown, code: ConfigErrorCode): void {
  expect(fn).toThrowError(expect.objectContaining({ name: 'ConfigError', code }));
}

describe('validateLibraryRoot', () => {
  it('accepts a dedicated music directory and returns its canonical path', () => {
    expect(validateLibraryRoot(music, ctx())).toBe(music);
    expect(validateLibraryRoot(`${music}/./`, ctx())).toBe(music);
  });

  it('accepts a sibling whose name merely starts like an app dir', () => {
    const lookalike = path.join(home, '.local/share/sonic-archive-music');
    fs.mkdirSync(lookalike, { recursive: true });
    expect(validateLibraryRoot(lookalike, ctx())).toBe(lookalike);
  });

  it('rejects relative paths and unexpanded ~', () => {
    expectCode(() => validateLibraryRoot('Music', ctx()), 'ROOT_NOT_ABSOLUTE');
    expectCode(() => validateLibraryRoot('~/Music', ctx()), 'ROOT_NOT_ABSOLUTE');
  });

  it('rejects NUL bytes', () => {
    expectCode(() => validateLibraryRoot(`${music}\0/x`, ctx()), 'ROOT_INVALID_CHARACTERS');
  });

  it('rejects the filesystem root', () => {
    expectCode(() => validateLibraryRoot('/', ctx()), 'ROOT_IS_FILESYSTEM_ROOT');
  });

  it('rejects the home directory and its ancestors', () => {
    expectCode(() => validateLibraryRoot(home, ctx()), 'ROOT_IS_HOME_OR_ANCESTOR');
    expectCode(() => validateLibraryRoot(sandbox, ctx()), 'ROOT_IS_HOME_OR_ANCESTOR');
    expectCode(() => validateLibraryRoot(`${music}/..`, ctx()), 'ROOT_IS_HOME_OR_ANCESTOR');
  });

  it('rejects the real home directory without inspecting it', () => {
    const realHome = os.homedir();
    expectCode(
      () => validateLibraryRoot(realHome, ctx({ homeDir: realHome })),
      'ROOT_IS_HOME_OR_ANCESTOR',
    );
  });

  it('rejects a symlink that resolves to the home directory or above', () => {
    const toHome = path.join(music, 'link-to-home');
    const toAbove = path.join(music, 'link-to-sandbox');
    fs.symlinkSync(home, toHome);
    fs.symlinkSync(sandbox, toAbove);
    expectCode(() => validateLibraryRoot(toHome, ctx()), 'ROOT_IS_HOME_OR_ANCESTOR');
    expectCode(() => validateLibraryRoot(toAbove, ctx()), 'ROOT_IS_HOME_OR_ANCESTOR');
  });

  it('rejects a missing directory', () => {
    expectCode(() => validateLibraryRoot(path.join(home, 'Nope'), ctx()), 'ROOT_NOT_FOUND');
  });

  it('rejects a regular file', () => {
    const file = path.join(home, 'track.flac');
    fs.writeFileSync(file, '');
    expectCode(() => validateLibraryRoot(file, ctx()), 'ROOT_NOT_DIRECTORY');
  });

  it('rejects a root that contains an application directory', () => {
    const inside = { ...appDirs, dataDir: path.join(music, '.sonic-archive') };
    expectCode(() => validateLibraryRoot(music, ctx({ appDirs: inside })), 'ROOT_OVERLAPS_APP_DIR');
  });

  it('rejects a root inside an application directory', () => {
    const nested = path.join(appDirs.cacheDir, 'music');
    fs.mkdirSync(nested, { recursive: true });
    expectCode(() => validateLibraryRoot(nested, ctx()), 'ROOT_OVERLAPS_APP_DIR');
  });

  it('rejects overlap hidden behind a symlinked app directory', () => {
    const linkedData = path.join(sandbox, 'data-link');
    fs.symlinkSync(music, linkedData);
    const viaLink = { ...appDirs, dataDir: path.join(linkedData, 'sonic-archive') };
    expectCode(
      () => validateLibraryRoot(music, ctx({ appDirs: viaLink })),
      'ROOT_OVERLAPS_APP_DIR',
    );
  });

  it('enforces the sandbox when one is given', () => {
    const elsewhere = path.join(sandbox, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const sandboxed = ctx({ sandboxDirs: [path.join(sandbox, 'fixtures')] });
    expectCode(() => validateLibraryRoot(elsewhere, sandboxed), 'ROOT_OUTSIDE_TEST_SANDBOX');
    expect(validateLibraryRoot(music, ctx({ sandboxDirs: [sandbox] }))).toBe(music);
  });
});
