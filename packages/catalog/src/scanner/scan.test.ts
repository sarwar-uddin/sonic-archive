import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogDatabase } from '../db/database.ts';
import { createTempCatalog, type TempCatalog } from '../db/test-support.ts';
import { createLibraryReader, type LibraryReader } from '../fs/library-reader.ts';
import {
  copyFixtureLibrary,
  FIXTURE_AUDIO_COUNT,
  FIXTURE_LIBRARY,
  type LibraryCopy,
  makeReadOnly,
  makeWritable,
  RUNNING_AS_ROOT,
  snapshotTree,
} from '../testing/fixtures.ts';
import { runScan, type ScanOptions } from './scan.ts';

let catalog: TempCatalog;
let lib: LibraryCopy;
let reader: LibraryReader;
let cacheDir: string;

beforeEach(() => {
  catalog = createTempCatalog();
  lib = copyFixtureLibrary();
  reader = createLibraryReader(lib.root);
  cacheDir = path.join(catalog.dataDir, 'cache');
});

afterEach(() => {
  lib.cleanup();
  catalog.cleanup();
});

function scan(options: Partial<ScanOptions> = {}) {
  return runScan(
    { db: catalog.database.db, reader, cacheDir },
    { mode: 'incremental', ...options },
  );
}

function query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return (catalog.database as CatalogDatabase).sqlite.prepare(sql).all(...params) as T[];
}

function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T {
  const [row] = query<T>(sql, ...params);
  if (row === undefined) throw new Error(`No row for: ${sql}`);
  return row;
}

/** Ids and keys of everything a scan creates, for idempotency checks. */
function catalogState() {
  return {
    files: query('SELECT id, rel_path, status FROM files ORDER BY id'),
    tracks: query('SELECT id, file_id, album_id, title FROM tracks ORDER BY id'),
    albums: query('SELECT id, group_key FROM albums ORDER BY id'),
    artists: query('SELECT id, name_key FROM artists ORDER BY id'),
    genres: query('SELECT id, name_key FROM genres ORDER BY id'),
    artwork: query('SELECT id, sha256 FROM artwork ORDER BY id'),
    credits: query('SELECT * FROM track_artists ORDER BY track_id, role, position'),
  };
}

const UNTAGGED = 'Untagged/unknown.flac';
const GARBAGE = 'Broken/garbage.flac';

describe('first scan of the fixture library', () => {
  it('indexes every audio file and records the corrupt one as an error', async () => {
    const summary = await scan();
    expect(summary).toMatchObject({
      status: 'completed',
      swept: true,
      scopeSubpath: null,
      counters: {
        seen: FIXTURE_AUDIO_COUNT,
        added: FIXTURE_AUDIO_COUNT - 1,
        updated: 0,
        unchanged: 0,
        missing: 0,
        restored: 0,
        errors: 1,
      },
    });
    expect(summary.problems).toEqual([
      { relPath: GARBAGE, message: expect.stringMatching(/FLAC/) },
    ]);
    expect(one('SELECT status, error_message FROM files WHERE rel_path = ?', GARBAGE)).toEqual({
      status: 'error',
      error_message: expect.stringMatching(/FLAC/),
    });
    expect(one('SELECT count(*) AS n FROM tracks')).toEqual({ n: FIXTURE_AUDIO_COUNT - 1 });
  });

  it('skips hidden files, AppleDouble files and non-audio files', async () => {
    await scan();
    const paths = query<{ rel_path: string }>('SELECT rel_path FROM files').map((r) => r.rel_path);
    expect(paths.some((p) => p.includes('.hidden') || p.includes('._') || p.endsWith('.txt'))).toBe(
      false,
    );
    expect(reader.stats.skippedHidden).toBeGreaterThanOrEqual(3);
    // notes.txt plus four images (cover/folder/back.jpg, Artwork/Front.png)
    expect(reader.stats.skippedNonAudio).toBe(5);
  });

  it('groups tracks into albums', async () => {
    await scan();
    expect(query('SELECT group_key, title FROM albums ORDER BY group_key')).toEqual([
      { group_key: 'dir:Untagged', title: 'Untagged' },
      { group_key: 'mbid:11111111-2222-4333-8444-555555555555', title: 'Double Album' },
      { group_key: 'tag:aurora field|loose copies', title: 'Loose Copies' },
      { group_key: 'tag:aurora field|northern lines', title: 'Northern Lines' },
      { group_key: 'tag:basalt quartet|hi-res session', title: 'Hi-Res Session' },
      { group_key: 'tag:cinder collective|format sampler', title: 'Format Sampler' },
      { group_key: 'tag:isold|agætis morgunn', title: 'Ágætis Morgunn' },
      { group_key: 'tag:koji ensemble|夜明け', title: '夜明け' },
      { group_key: 'tag:various artists|harbour lights', title: 'Harbour Lights' },
    ]);
  });

  it('merges both discs of a multi-disc album', async () => {
    await scan();
    expect(
      query(
        `SELECT t.title, t.disc_no, a.total_discs FROM tracks t JOIN albums a ON a.id = t.album_id
         WHERE a.title = 'Double Album' ORDER BY t.disc_no`,
      ),
    ).toEqual([
      { title: 'Side A', disc_no: 1, total_discs: 2 },
      { title: 'Side C', disc_no: 2, total_discs: 2 },
    ]);
  });

  it('records technical details per format', async () => {
    await scan();
    const rows = query(
      `SELECT f.rel_path, t.codec, t.lossless, t.sample_rate, t.bit_depth
       FROM tracks t JOIN files f ON f.id = t.file_id
       WHERE f.rel_path LIKE 'Basalt%' OR f.rel_path LIKE 'Cinder%' ORDER BY f.rel_path`,
    );
    expect(rows.map(({ rel_path, ...rest }) => [path.basename(rel_path as string), rest])).toEqual([
      ['01 Overture.flac', { codec: 'FLAC', lossless: 1, sample_rate: 96000, bit_depth: 24 }],
      ['02 Coda.m4a', { codec: 'ALAC', lossless: 1, sample_rate: 44100, bit_depth: 16 }],
      ['01 Wave.wav', { codec: 'PCM', lossless: 1, sample_rate: 44100, bit_depth: 16 }],
      ['02 Interchange.aiff', { codec: 'PCM', lossless: 1, sample_rate: 44100, bit_depth: 16 }],
      [
        '03 Lossy.mp3',
        { codec: 'MPEG 1 Layer 3', lossless: 0, sample_rate: 44100, bit_depth: null },
      ],
      ['04 Open.opus', { codec: 'Opus', lossless: 0, sample_rate: 48000, bit_depth: null }],
    ]);
  });

  it('credits multiple artists, composers and a compilation album artist', async () => {
    await scan();
    expect(
      query(
        `SELECT ar.name, ta.role, ta.position FROM track_artists ta
         JOIN artists ar ON ar.id = ta.artist_id JOIN tracks t ON t.id = ta.track_id
         WHERE t.title = 'Duet' ORDER BY ta.role, ta.position`,
      ),
    ).toEqual([
      { name: 'Echo Park', role: 'artist', position: 0 },
      { name: 'Fen Lowe', role: 'artist', position: 1 },
      { name: 'Gil Moreno', role: 'composer', position: 0 },
    ]);
    expect(one("SELECT display_artist FROM tracks WHERE title = 'Duet'")).toEqual({
      display_artist: 'Echo Park, Fen Lowe',
    });
    expect(
      one(
        `SELECT ar.name FROM albums a JOIN artists ar ON ar.id = a.album_artist_id
         WHERE a.title = 'Harbour Lights'`,
      ),
    ).toEqual({ name: 'Various Artists' });
    // One artist row, credited across three albums.
    expect(one("SELECT count(*) AS n FROM artists WHERE name = 'Aurora Field'")).toEqual({ n: 1 });
  });

  it('splits multi-genre fields and shares genres between tracks', async () => {
    await scan();
    expect(query('SELECT name FROM genres ORDER BY name')).toEqual([
      { name: 'Ambient' },
      { name: 'Chamber' },
      { name: 'Classical' },
    ]);
  });

  it('stores each distinct cover once, in the cache dir', async () => {
    await scan();
    const artwork = query<{ cache_file: string }>('SELECT cache_file FROM artwork');
    for (const art of artwork) {
      expect(fs.existsSync(path.join(cacheDir, 'artwork', art.cache_file))).toBe(true);
    }
    // Red is embedded in two tracks but stored once. Blue (embedded in
    // Drift CD1) is never stored, because Drift's folder.jpg wins.
    expect(
      query(
        `SELECT a.title, w.source, w.mime FROM albums a JOIN artwork w ON w.id = a.artwork_id
         ORDER BY a.title`,
      ),
    ).toEqual([
      { title: 'Double Album', source: 'folder', mime: 'image/jpeg' },
      { title: 'Format Sampler', source: 'folder', mime: 'image/png' },
      { title: 'Hi-Res Session', source: 'folder', mime: 'image/jpeg' },
      { title: 'Northern Lines', source: 'embedded', mime: 'image/jpeg' },
    ]);
    expect(artwork).toHaveLength(4);
  });

  it('still records that a track embeds art when folder art is used', async () => {
    await scan();
    expect(one("SELECT has_embedded_art FROM tracks WHERE title = 'Side A'")).toEqual({
      has_embedded_art: 1,
    });
  });

  it('fills in a cover added to the folder later, without re-reading audio', async () => {
    await scan();
    expect(one("SELECT artwork_id FROM albums WHERE title = 'Untagged'")).toEqual({
      artwork_id: null,
    });
    fs.copyFileSync(
      path.join(lib.root, 'Basalt Quartet/Hi-Res Session (2020)/cover.jpg'),
      path.join(lib.root, 'Untagged/Folder.JPG'),
    );
    const summary = await scan();
    expect(summary.counters).toMatchObject({ unchanged: FIXTURE_AUDIO_COUNT - 1, updated: 0 });
    expect(one("SELECT artwork_id FROM albums WHERE title = 'Untagged'")).toEqual({
      artwork_id: expect.any(Number),
    });
  });

  it('skips unreadable folder art without failing the file', async () => {
    if (RUNNING_AS_ROOT) return;
    fs.chmodSync(path.join(lib.root, 'Basalt Quartet/Hi-Res Session (2020)/cover.jpg'), 0o000);
    const summary = await scan();
    expect(summary.counters.errors).toBe(1); // only the garbage file
    expect(one("SELECT artwork_id FROM albums WHERE title = 'Hi-Res Session'")).toEqual({
      artwork_id: null,
    });
  });

  it('reads the FLAC audio MD5, matching identical audio under different tags', async () => {
    await scan();
    const md5 = (relPath: string) =>
      one<{ audio_md5: string | null }>('SELECT audio_md5 FROM files WHERE rel_path = ?', relPath)
        .audio_md5;
    const original = md5('Aurora Field/Northern Lines (2001)/01 First Light.flac');
    expect(original).toBe('f92951abe8308de3f54a91cda07e7faa'); // as reported by metaflac
    expect(md5('Duplicates/First Light (copy).flac')).toBe(original);
    expect(md5('Aurora Field/Northern Lines (2001)/02 Polar Night.flac')).not.toBe(original);
    expect(md5('Basalt Quartet/Hi-Res Session (2020)/02 Coda.m4a')).toBeNull();
  });

  it('keeps non-ASCII paths and names intact', async () => {
    await scan();
    expect(
      one(
        "SELECT f.rel_path, t.title FROM files f JOIN tracks t ON t.file_id = f.id WHERE t.title = '光'",
      ),
    ).toEqual({ rel_path: 'Kōji Ensemble/夜明け (2018)/01 光.flac', title: '光' });
  });
});

describe('rescanning', () => {
  it('is idempotent: identical rows and ids', async () => {
    await scan();
    const before = catalogState();
    const summary = await scan();
    expect(summary.counters).toEqual({
      seen: FIXTURE_AUDIO_COUNT,
      added: 0,
      updated: 0,
      unchanged: FIXTURE_AUDIO_COUNT - 1,
      missing: 0,
      restored: 0,
      errors: 1,
    });
    expect(catalogState()).toEqual(before);
  });

  it('a full rescan re-reads every file without duplicating anything', async () => {
    await scan();
    const before = catalogState();
    const summary = await scan({ mode: 'full' });
    expect(summary.counters.unchanged).toBe(FIXTURE_AUDIO_COUNT - 1);
    expect(catalogState()).toEqual(before);
  });

  it('re-reads a modified file and leaves unchanged ones alone', async () => {
    await scan();
    const target = path.join(lib.root, 'Aurora Field/Northern Lines (2001)/02 Polar Night.flac');
    fs.copyFileSync(path.join(lib.root, 'Ísold/Ágætis Morgunn (2005)/01 Svefn.flac'), target);
    fs.utimesSync(target, new Date(), new Date('2030-01-01'));

    const summary = await scan();
    expect(summary.counters).toMatchObject({ updated: 1, unchanged: FIXTURE_AUDIO_COUNT - 2 });
    expect(
      one(
        `SELECT t.title FROM tracks t JOIN files f ON f.id = t.file_id
         WHERE f.rel_path = 'Aurora Field/Northern Lines (2001)/02 Polar Night.flac'`,
      ),
    ).toEqual({ title: 'Svefn' });
  });

  it('recovers a previously corrupt file once it becomes readable', async () => {
    await scan();
    const target = path.join(lib.root, GARBAGE);
    fs.copyFileSync(path.join(lib.root, UNTAGGED), target);
    fs.utimesSync(target, new Date(), new Date('2030-01-01'));
    const summary = await scan();
    expect(summary.counters).toMatchObject({ updated: 1, errors: 0 });
    expect(one('SELECT status, error_message FROM files WHERE rel_path = ?', GARBAGE)).toEqual({
      status: 'present',
      error_message: null,
    });
  });
});

describe('missing files', () => {
  it('marks a removed file missing without deleting anything, and restores it', async () => {
    await scan();
    const absolute = path.join(lib.root, UNTAGGED);
    const stash = path.join(lib.outside, 'unknown.flac');
    fs.renameSync(absolute, stash);

    const removed = await scan();
    expect(removed.counters).toMatchObject({ missing: 1, seen: FIXTURE_AUDIO_COUNT - 1 });
    expect(one('SELECT status, missing_since FROM files WHERE rel_path = ?', UNTAGGED)).toEqual({
      status: 'missing',
      missing_since: expect.any(Number),
    });
    // The track and its album survive: missing is a state, not a deletion.
    expect(
      one(
        'SELECT count(*) AS n FROM tracks t JOIN files f ON f.id = t.file_id WHERE f.rel_path = ?',
        UNTAGGED,
      ),
    ).toEqual({ n: 1 });

    // Already-missing files are not counted again.
    expect((await scan()).counters.missing).toBe(0);

    fs.renameSync(stash, absolute);
    const restored = await scan();
    expect(restored.counters).toMatchObject({ restored: 1, missing: 0 });
    expect(one('SELECT status, missing_since FROM files WHERE rel_path = ?', UNTAGGED)).toEqual({
      status: 'present',
      missing_since: null,
    });
  });

  it('refuses to mark many files missing at once', async () => {
    await scan();
    fs.rmSync(path.join(lib.root, 'Cinder Collective'), { recursive: true });
    const threshold = { ratio: 0.2, minCount: 2 };

    const refused = await scan({ massMissing: threshold });
    expect(refused).toMatchObject({ status: 'aborted', swept: false });
    expect(refused.reason).toMatch(/4 of 17 known files were not found/);
    expect(one("SELECT count(*) AS n FROM files WHERE status = 'missing'")).toEqual({ n: 0 });

    const allowed = await scan({ massMissing: threshold, allowMassMissing: true });
    expect(allowed).toMatchObject({ status: 'completed', counters: { missing: 4 } });
  });

  it('treats an emptied library as a mistake under the default threshold', async () => {
    await scan();
    for (const entry of fs.readdirSync(lib.root)) {
      fs.rmSync(path.join(lib.root, entry), { recursive: true });
    }
    const summary = await scan();
    expect(summary).toMatchObject({ status: 'aborted', swept: false });
    expect(one("SELECT count(*) AS n FROM files WHERE status = 'missing'")).toEqual({ n: 0 });
  });

  it.skipIf(RUNNING_AS_ROOT)('does not sweep when a folder could not be read', async () => {
    await scan();
    const locked = path.join(lib.root, 'Drift');
    fs.chmodSync(locked, 0o000);
    try {
      const summary = await scan();
      expect(summary).toMatchObject({ status: 'completed', swept: false });
      expect(summary.reason).toMatch(/could not be read/);
      expect(summary.problems).toContainEqual({ relPath: 'Drift', message: expect.any(String) });
      expect(one("SELECT count(*) AS n FROM files WHERE status = 'missing'")).toEqual({ n: 0 });
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it('never sweeps after a cancelled scan', async () => {
    await scan();
    fs.rmSync(path.join(lib.root, UNTAGGED));
    const controller = new AbortController();
    controller.abort();
    const summary = await scan({ signal: controller.signal });
    expect(summary).toMatchObject({ status: 'aborted', swept: false });
    expect(one('SELECT status FROM files WHERE rel_path = ?', UNTAGGED)).toEqual({
      status: 'present',
    });
  });
});

describe('scoped (sample) scans', () => {
  it('reads only the chosen folder and never marks anything missing', async () => {
    const summary = await scan({ subpath: 'Drift' });
    expect(summary).toMatchObject({
      status: 'completed',
      scopeSubpath: 'Drift',
      swept: false,
      counters: { seen: 2, added: 2 },
    });
    expect(one('SELECT scope_subpath FROM scans')).toEqual({ scope_subpath: 'Drift' });

    // After a full scan, a scoped scan leaves everything outside it untouched.
    await scan();
    await scan({ subpath: 'Drift/Double Album (1999)/CD1' });
    expect(one("SELECT count(*) AS n FROM files WHERE status = 'missing'")).toEqual({ n: 0 });
  });

  it('treats "." as the whole library', async () => {
    expect((await scan({ subpath: '.' })).scopeSubpath).toBeNull();
  });

  it.each([
    ['../outside', /outside the library root/],
    ['/etc', /root-relative/],
    ['Untagged/unknown.flac', /not a directory/],
    ['No Such Folder', /does not exist/],
  ])('rejects the scope %s', async (subpath, message) => {
    await expect(scan({ subpath })).rejects.toThrow(message);
    expect(one('SELECT count(*) AS n FROM scans')).toEqual({ n: 0 });
  });
});

describe('symlinks', () => {
  it('never follows links, including ones that lead outside the root', async () => {
    fs.copyFileSync(path.join(lib.root, UNTAGGED), path.join(lib.outside, 'escaped.flac'));
    fs.symlinkSync(lib.outside, path.join(lib.root, 'Linked Folder'));
    fs.symlinkSync(path.join(lib.outside, 'escaped.flac'), path.join(lib.root, 'linked.flac'));

    const summary = await scan();
    expect(summary.counters.seen).toBe(FIXTURE_AUDIO_COUNT);
    expect(reader.stats.skippedSymlinks).toBe(2);
    expect(one("SELECT count(*) AS n FROM files WHERE rel_path LIKE '%escaped%'")).toEqual({
      n: 0,
    });
  });
});

describe('read-only guarantee', () => {
  it('leaves every library file byte-for-byte unchanged, even when write-protected', async () => {
    const before = snapshotTree(lib.root);
    if (!RUNNING_AS_ROOT) makeReadOnly(lib.root);
    const locked = snapshotTree(lib.root);

    // A full scan reads every file's contents; run it twice for good measure.
    const first = await scan({ mode: 'full' });
    const second = await scan({ mode: 'full' });
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(first.counters.errors).toBe(1); // only the deliberate garbage file

    expect(snapshotTree(lib.root)).toEqual(locked);
    makeWritable(lib.root);
    const after = snapshotTree(lib.root);
    for (const [relPath, print] of before) {
      expect(after.get(relPath)).toMatchObject({
        sha256: print.sha256,
        size: print.size,
        mtimeMs: print.mtimeMs,
      });
    }
  });

  it('can scan the committed fixtures in place without changing them', async () => {
    const before = snapshotTree(FIXTURE_LIBRARY);
    const inPlace = createLibraryReader(FIXTURE_LIBRARY);
    const summary = await runScan(
      { db: catalog.database.db, reader: inPlace, cacheDir },
      { mode: 'full' },
    );
    expect(summary.counters.seen).toBe(FIXTURE_AUDIO_COUNT);
    expect(snapshotTree(FIXTURE_LIBRARY)).toEqual(before);
  });
});

describe('dry run', () => {
  it('walks and compares without reading contents or writing anything', async () => {
    const summary = await scan({ dryRun: true });
    expect(summary).toMatchObject({
      status: 'dry-run',
      scanId: null,
      counters: { seen: FIXTURE_AUDIO_COUNT, added: FIXTURE_AUDIO_COUNT },
    });
    expect(summary.totalBytes).toBeGreaterThan(0);
    for (const table of ['library_roots', 'scans', 'files', 'tracks']) {
      expect(one(`SELECT count(*) AS n FROM ${table}`)).toEqual({ n: 0 });
    }
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it('reports what an incremental scan would change', async () => {
    await scan();
    fs.rmSync(path.join(lib.root, UNTAGGED));
    const summary = await scan({ dryRun: true });
    expect(summary.counters).toMatchObject({
      seen: FIXTURE_AUDIO_COUNT - 1,
      unchanged: FIXTURE_AUDIO_COUNT - 1,
      added: 0,
    });
    expect(one("SELECT count(*) AS n FROM files WHERE status = 'missing'")).toEqual({ n: 0 });
  });
});

describe('scan history', () => {
  it('records each scan and closes scans left running by a crash', async () => {
    await scan();
    catalog.database.sqlite
      .prepare(
        "INSERT INTO scans (root_id, started_at, status, mode) VALUES (1, 0, 'running', 'full')",
      )
      .run();
    await scan();
    expect(query('SELECT status, error_message FROM scans ORDER BY id')).toEqual([
      { status: 'completed', error_message: null },
      { status: 'aborted', error_message: 'Interrupted before completion.' },
      { status: 'completed', error_message: null },
    ]);
  });
});
