import fs from 'node:fs';
import path from 'node:path';
import { createLibraryReader } from '@sonic-archive/catalog';
import {
  copyFixtureLibrary,
  createTempCatalog,
  FIXTURE_AUDIO_COUNT,
  type LibraryCopy,
  type TempCatalog,
} from '@sonic-archive/catalog/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLiveLibrary } from './live.ts';

let catalog: TempCatalog;
let lib: LibraryCopy;
let live: ReturnType<typeof startLiveLibrary> | null = null;

beforeEach(() => {
  catalog = createTempCatalog();
  lib = copyFixtureLibrary();
});

afterEach(() => {
  live?.close();
  lib.cleanup();
  catalog.cleanup();
});

const count = (sql: string) => (catalog.database.sqlite.prepare(sql).get() as { n: number }).n;

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('startLiveLibrary', () => {
  it('catches up on start, then follows new and removed files', async () => {
    const lines: string[] = [];
    live = startLiveLibrary({
      db: catalog.database.db,
      reader: createLibraryReader(lib.root),
      cacheDir: path.join(catalog.dataDir, 'cache'),
      log: (line) => lines.push(line),
      quietMs: 50,
    });
    await until(() => count("SELECT count(*) AS n FROM scans WHERE status = 'completed'") === 1);
    expect(count('SELECT count(*) AS n FROM files')).toBe(FIXTURE_AUDIO_COUNT);

    // A new rip arrives.
    const dir = path.join(lib.root, 'Aurora Field/Northern Lines (2001)');
    fs.copyFileSync(path.join(dir, '02 Polar Night.flac'), path.join(dir, '03 Copy.flac'));
    await until(() => count('SELECT count(*) AS n FROM files') === FIXTURE_AUDIO_COUNT + 1);
    await live.idle();
    expect(lines.at(-1)).toMatch(/1 added/);

    // A file is deleted: marked missing, never deleted from the catalog.
    fs.rmSync(path.join(dir, '03 Copy.flac'));
    await until(() => count("SELECT count(*) AS n FROM files WHERE status = 'missing'") === 1);
    expect(count('SELECT count(*) AS n FROM files')).toBe(FIXTURE_AUDIO_COUNT + 1);
  });

  it('does not rescan in a loop from its own reads', async () => {
    live = startLiveLibrary({
      db: catalog.database.db,
      reader: createLibraryReader(lib.root),
      cacheDir: path.join(catalog.dataDir, 'cache'),
      log: () => {},
      quietMs: 50,
    });
    await until(() => count('SELECT count(*) AS n FROM scans') >= 1);
    await live.idle();
    await new Promise((r) => setTimeout(r, 400));
    expect(count('SELECT count(*) AS n FROM scans')).toBe(1);
  });
});
