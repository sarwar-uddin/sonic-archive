import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AppDirs, CONFIG_FILE_NAME } from '@sonic-archive/catalog';
import {
  copyFixtureLibrary,
  createTempCatalog,
  FIXTURE_AUDIO_COUNT,
  type LibraryCopy,
  type TempCatalog,
} from '@sonic-archive/catalog/testing';
import type { LibraryStatus } from '@sonic-archive/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryService, type LibraryService } from './library-service.ts';

let catalog: TempCatalog;
let lib: LibraryCopy;
let dirs: AppDirs;
let service: LibraryService | null = null;

beforeEach(() => {
  catalog = createTempCatalog();
  lib = copyFixtureLibrary();
  dirs = {
    configDir: path.join(catalog.dataDir, 'config'),
    dataDir: catalog.dataDir,
    cacheDir: path.join(catalog.dataDir, 'cache'),
  };
});

afterEach(async () => {
  await service?.close();
  service = null;
  lib.cleanup();
  catalog.cleanup();
});

const count = (sql: string) => (catalog.database.sqlite.prepare(sql).get() as { n: number }).n;
const config = () =>
  JSON.parse(fs.readFileSync(path.join(dirs.configDir, CONFIG_FILE_NAME), 'utf8'));

function start(initialRoot: string | null = null, source: 'env' | 'file' = 'file') {
  service = createLibraryService({
    env: { NODE_ENV: 'test' },
    homeDir: os.homedir(),
    dirs,
    initial: initialRoot
      ? { status: 'configured', root: initialRoot, source }
      : { status: 'unconfigured' },
    settings: { watch: false },
    database: catalog.database,
    quietMs: 20,
    log: () => {},
  });
  return service;
}

async function settled(s: LibraryService): Promise<LibraryStatus> {
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (s.status().state === 'idle' && count('SELECT count(*) AS n FROM scans') > 0) break;
  }
  return s.status();
}

describe('library service', () => {
  it('starts unconfigured, then validates, saves and scans a chosen folder', async () => {
    const s = start();
    expect(s.status()).toMatchObject({ root: null, state: 'unconfigured', source: null });
    expect(s.reader()).toBeNull();
    const seen: LibraryStatus[] = [];
    s.subscribe((status) => seen.push(status));

    await s.setRoot(lib.root);
    expect(config()).toEqual({ libraryRoot: lib.root });
    const status = await settled(s);
    expect(status).toMatchObject({ root: lib.root, source: 'file', state: 'idle', error: null });
    expect(count('SELECT count(*) AS n FROM files')).toBe(FIXTURE_AUDIO_COUNT);
    expect(seen.some((x) => x.state === 'scanning')).toBe(true);
    expect(s.reader()?.root).toBe(lib.root);
  });

  it('refuses unsafe folders with a reason, and changes nothing', async () => {
    const s = start();
    await expect(s.setRoot('/')).rejects.toMatchObject({ code: 'ROOT_IS_FILESYSTEM_ROOT' });
    await expect(s.setRoot(os.homedir())).rejects.toMatchObject({
      code: 'ROOT_IS_HOME_OR_ANCESTOR',
    });
    await expect(s.setRoot(path.join(lib.root, 'nope'))).rejects.toMatchObject({
      code: 'ROOT_NOT_FOUND',
    });
    await expect(s.setRoot('relative/music')).rejects.toMatchObject({ code: 'ROOT_NOT_ABSOLUTE' });
    await expect(s.setRoot(dirs.dataDir)).rejects.toMatchObject({ code: 'ROOT_OVERLAPS_APP_DIR' });
    expect(fs.existsSync(path.join(dirs.configDir, CONFIG_FILE_NAME))).toBe(false);
    expect(s.status().root).toBeNull();
  });

  it('rebuilds the catalog when switching to another folder', async () => {
    const s = start(lib.root);
    await settled(s);
    const other = path.join(lib.outside, 'Other Music');
    fs.cpSync(path.join(lib.root, 'Drift'), path.join(other, 'Drift'), { recursive: true });
    await s.setRoot(other);
    await settled(s);
    expect(count('SELECT count(*) AS n FROM library_roots')).toBe(1);
    expect(count('SELECT count(*) AS n FROM files')).toBe(2); // Drift's two discs
    // Choosing the same folder again keeps everything.
    const files = count('SELECT max(id) AS n FROM files');
    await s.setRoot(other);
    expect(count('SELECT max(id) AS n FROM files')).toBe(files);
  });

  it('cannot change a folder set by SONIC_LIBRARY_ROOT', async () => {
    const s = start(lib.root, 'env');
    await settled(s);
    expect(s.status().source).toBe('env');
    await expect(s.setRoot(lib.outside)).rejects.toMatchObject({ code: 'ROOT_SET_BY_ENVIRONMENT' });
  });

  it('saves the watching setting and rescans on request', async () => {
    const s = start(lib.root);
    await settled(s);
    expect(s.setWatching(true).watching).toBe(true);
    expect(config()).toEqual({ watch: true });
    s.rescan(false);
    await new Promise((r) => setTimeout(r, 50));
    await settled(s);
    expect(count('SELECT count(*) AS n FROM scans')).toBe(2);
  });
});
