import fs from 'node:fs';
import path from 'node:path';
import { createLibraryReader, runScan } from '@sonic-archive/catalog';
import {
  copyFixtureLibrary,
  createTempCatalog,
  type LibraryCopy,
  type TempCatalog,
} from '@sonic-archive/catalog/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeLibrary, createSpanMeters, decodeArgs, decodeFormat } from './analyze.ts';

describe('decodeArgs', () => {
  it('reads one local file and writes raw samples only to a pipe', () => {
    const args = decodeArgs('/music/a.flac', 44_100, 2);
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(args[args.indexOf('-i') + 1]).toBe('file:/music/a.flac');
    expect(args).toEqual(expect.arrayContaining(['-nostdin', '-protocol_whitelist', 'file']));
    expect(args.slice(-5)).toEqual(['-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1']);
  });

  it('analyses DSD at 88.2 kHz and keeps other formats as they are', () => {
    expect(decodeFormat({ codec: 'DSD', sampleRate: 2_822_400, channels: 2 })).toEqual({
      sampleRate: 88_200,
      channels: 2,
    });
    expect(decodeFormat({ codec: 'FLAC', sampleRate: 96_000, channels: null })).toEqual({
      sampleRate: 96_000,
      channels: 2,
    });
  });
});

describe('createSpanMeters', () => {
  it('measures each span of a stream on its own, skipping audio outside them', () => {
    const rate = 1000;
    const meters = createSpanMeters(
      [
        { trackId: 1, startMs: 1000, endMs: 4000 },
        { trackId: 2, startMs: 4000, endMs: null },
      ],
      rate,
      1,
    );
    // 1 s of full-scale "pregap", 3 s at 0.5, then 3 s at 0.25; fed in odd chunks.
    const audio = new Float32Array(7 * rate);
    for (let i = 0; i < audio.length; i++) {
      const level = i < rate ? 1 : i < 4 * rate ? 0.5 : 0.25;
      audio[i] = i % 2 ? level : -level;
    }
    for (let i = 0; i < audio.length; i += 777) meters.push(audio.subarray(i, i + 777));
    const [first, second] = meters.results();
    expect(first?.peakDb).toBeCloseTo(-6.02, 1); // the pregap's full-scale samples are ignored
    expect(second?.peakDb).toBeCloseTo(-12.04, 1);
  });
});

describe('analyzeLibrary (with ffmpeg)', () => {
  let catalog: TempCatalog;
  let lib: LibraryCopy;

  beforeEach(async () => {
    catalog = createTempCatalog();
    lib = copyFixtureLibrary();
    await runScan(
      { db: catalog.database.db, reader: createLibraryReader(lib.root), cacheDir: lib.outside },
      { mode: 'incremental' },
    );
  });

  afterEach(() => {
    lib.cleanup();
    catalog.cleanup();
  });

  const rows = () =>
    catalog.database.sqlite
      .prepare(
        `SELECT t.title, d.dr_exact, d.peak_db FROM track_dynamics d
         JOIN tracks t ON t.id = d.track_id ORDER BY t.title`,
      )
      .all() as { title: string; dr_exact: number | null; peak_db: number | null }[];

  it('measures every track, the tracks of a CD image one by one, and only once', async () => {
    const reader = createLibraryReader(lib.root);
    const first = await analyzeLibrary({ db: catalog.database.db, reader });
    expect(first.failed).toEqual([]);
    const tracks = (
      catalog.database.sqlite.prepare('SELECT count(*) AS n FROM tracks').get() as { n: number }
    ).n;
    expect(first.tracks).toBe(tracks);
    // Ember's image tracks are each 1 s of a steady sine: DR0.
    const ember = rows().filter((r) =>
      ['Kindling', 'Smoke', 'Ash', 'Embers', 'Daybreak'].includes(r.title),
    );
    expect(ember).toHaveLength(5);
    for (const r of ember) expect(r.dr_exact).toBeCloseTo(0, 0);

    const again = await analyzeLibrary({ db: catalog.database.db, reader });
    expect(again).toEqual({ files: 0, tracks: 0, failed: [], ffmpegMissing: false });
  });

  it('stops, without failing every file or crashing, when ffmpeg is missing', async () => {
    const summary = await analyzeLibrary({
      db: catalog.database.db,
      reader: createLibraryReader(lib.root),
      command: path.join(lib.outside, 'no-ffmpeg-here'),
    });
    expect(summary).toEqual({ files: 0, tracks: 0, failed: [], ffmpegMissing: true });
    expect(rows()).toEqual([]);
  });

  it('measures a track again after its file changes', async () => {
    const reader = createLibraryReader(lib.root);
    await analyzeLibrary({ db: catalog.database.db, reader });
    const file = path.join(lib.root, 'Aurora Field/Northern Lines (2001)/01 First Light.flac');
    fs.utimesSync(file, new Date(), new Date(2_000_000_000_000));
    await runScan(
      { db: catalog.database.db, reader, cacheDir: lib.outside },
      { mode: 'incremental' },
    );
    expect(await analyzeLibrary({ db: catalog.database.db, reader })).toMatchObject({
      files: 1,
      tracks: 1,
    });
  });
});
