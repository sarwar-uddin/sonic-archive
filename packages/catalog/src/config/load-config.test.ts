import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE_NAME, loadConfig } from './load-config.ts';

let sandbox: string;
let home: string;
let music: string;

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-config-')));
  home = path.join(sandbox, 'home');
  music = path.join(sandbox, 'Music');
  fs.mkdirSync(home);
  fs.mkdirSync(music);
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeConfigFile(contents: string): void {
  const dir = path.join(home, '.config/sonic-archive');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), contents);
}

describe('loadConfig', () => {
  it('is unconfigured when neither env nor config file names a root', () => {
    const config = loadConfig({ env: {}, homeDir: home });
    expect(config.library).toEqual({ status: 'unconfigured' });
    expect(config.dirs.dataDir).toBe(path.join(home, '.local/share/sonic-archive'));
  });

  it('reads the root from the config file', () => {
    writeConfigFile(JSON.stringify({ libraryRoot: music }));
    expect(loadConfig({ env: {}, homeDir: home }).library).toEqual({
      status: 'configured',
      root: music,
    });
  });

  it('lets SONIC_LIBRARY_ROOT override the config file', () => {
    const other = path.join(sandbox, 'Other');
    fs.mkdirSync(other);
    writeConfigFile(JSON.stringify({ libraryRoot: music }));
    const config = loadConfig({ env: { SONIC_LIBRARY_ROOT: other }, homeDir: home });
    expect(config.library).toEqual({ status: 'configured', root: other });
  });

  it('treats a blank SONIC_LIBRARY_ROOT as unset', () => {
    const config = loadConfig({ env: { SONIC_LIBRARY_ROOT: '  ' }, homeDir: home });
    expect(config.library.status).toBe('unconfigured');
  });

  it('rejects malformed JSON', () => {
    writeConfigFile('{ libraryRoot: ');
    expect(() => loadConfig({ env: {}, homeDir: home })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG_FILE' }),
    );
  });

  it('rejects unknown keys so typos are not silently ignored', () => {
    writeConfigFile(JSON.stringify({ libraryRot: music }));
    expect(() => loadConfig({ env: {}, homeDir: home })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG_FILE' }),
    );
  });

  it('propagates root validation failures', () => {
    expect(() => loadConfig({ env: { SONIC_LIBRARY_ROOT: home }, homeDir: home })).toThrowError(
      expect.objectContaining({ code: 'ROOT_IS_HOME_OR_ANCESTOR' }),
    );
  });

  it('confines roots to temp dirs or test-fixtures under test, even with an injected env', () => {
    // This test's own source directory: real, but outside the sandbox.
    const outside = import.meta.dirname;
    expect(() =>
      loadConfig({ env: { SONIC_LIBRARY_ROOT: outside, NODE_ENV: 'production' }, homeDir: home }),
    ).toThrowError(expect.objectContaining({ code: 'ROOT_OUTSIDE_TEST_SANDBOX' }));
  });
});
