import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getTrackByFileId,
  type TrackValues,
  upsertAlbum,
  upsertArtist,
  upsertArtwork,
  upsertGenre,
  upsertTrack,
} from './catalog-repository.ts';
import type { CatalogDb } from './database.ts';
import {
  ensureLibraryRoot,
  finishScan,
  getFileByPath,
  getScan,
  listScans,
  markFileSeen,
  type ScanCounters,
  startScan,
  upsertFile,
} from './library-repository.ts';
import { createTempCatalog, type TempCatalog } from './test-support.ts';

let catalog: TempCatalog;
let db: CatalogDb;

beforeEach(() => {
  catalog = createTempCatalog();
  db = catalog.database.db;
});

afterEach(() => {
  catalog.cleanup();
});

const ZERO: ScanCounters = {
  seen: 0,
  added: 0,
  updated: 0,
  unchanged: 0,
  missing: 0,
  restored: 0,
  errors: 0,
};

function count(table: string): number {
  return (
    catalog.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
      n: number;
    }
  ).n;
}

function newScan(rootId: number) {
  return startScan(db, { rootId, mode: 'incremental', scopeSubpath: null, startedAt: new Date() });
}

describe('library roots and scans', () => {
  it('ensureLibraryRoot is idempotent', () => {
    const a = ensureLibraryRoot(db, '/music');
    const b = ensureLibraryRoot(db, '/music');
    expect(b.id).toBe(a.id);
    expect(count('library_roots')).toBe(1);
  });

  it('records a scan from start to finish', () => {
    const root = ensureLibraryRoot(db, '/music');
    const scan = newScan(root.id);
    expect(scan.status).toBe('running');

    const finishedAt = new Date('2026-10-26T12:00:00Z');
    finishScan(db, scan.id, { status: 'completed', finishedAt, counters: { ...ZERO, seen: 3 } });

    expect(getScan(db, scan.id)).toMatchObject({ status: 'completed', seen: 3, finishedAt });
    expect(listScans(db).map((s) => s.id)).toEqual([scan.id]);
  });

  it('refuses to finish a scan twice', () => {
    const scan = newScan(ensureLibraryRoot(db, '/music').id);
    const input = { status: 'aborted', finishedAt: new Date(), counters: ZERO } as const;
    finishScan(db, scan.id, input);
    expect(() => finishScan(db, scan.id, input)).toThrow(/already finished/);
  });
});

describe('files', () => {
  it('upserts by (root, relative path) without duplicating rows', () => {
    const root = ensureLibraryRoot(db, '/music');
    const scan1 = newScan(root.id);
    const base = {
      rootId: root.id,
      relPath: 'Artist/Album/01.flac',
      size: 100,
      mtimeMs: 1_700_000_000_000,
      audioMd5: null,
      status: 'present',
      errorMessage: null,
    } as const;

    const first = upsertFile(db, { ...base, scanId: scan1.id });
    const scan2 = newScan(root.id);
    const second = upsertFile(db, { ...base, size: 200, scanId: scan2.id });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      size: 200,
      firstSeenScanId: scan1.id,
      lastSeenScanId: scan2.id,
    });
    expect(count('files')).toBe(1);
  });

  it('clears missing state when a file is seen again', () => {
    const root = ensureLibraryRoot(db, '/music');
    const scan = newScan(root.id);
    const file = upsertFile(db, {
      rootId: root.id,
      relPath: 'a.flac',
      size: 1,
      mtimeMs: 1,
      audioMd5: null,
      status: 'present',
      errorMessage: null,
      scanId: scan.id,
    });
    catalog.database.sqlite
      .prepare("UPDATE files SET status = 'missing', missing_since = 5 WHERE id = ?")
      .run(file.id);

    const again = upsertFile(db, { ...file, status: 'present', scanId: scan.id });
    expect(again).toMatchObject({ status: 'present', missingSince: null });
  });

  it('keeps the same path under different roots apart', () => {
    const scanA = newScan(ensureLibraryRoot(db, '/a').id);
    const scanB = newScan(ensureLibraryRoot(db, '/b').id);
    const input = {
      relPath: 'x.flac',
      size: 1,
      mtimeMs: 1,
      audioMd5: null,
      status: 'present',
      errorMessage: null,
    } as const;
    upsertFile(db, { ...input, rootId: scanA.rootId, scanId: scanA.id });
    upsertFile(db, { ...input, rootId: scanB.rootId, scanId: scanB.id });
    expect(count('files')).toBe(2);
  });

  it('rejects fractional mtimes so change detection compares like with like', () => {
    const scan = newScan(ensureLibraryRoot(db, '/music').id);
    expect(() =>
      upsertFile(db, {
        rootId: scan.rootId,
        relPath: 'a.flac',
        size: 1,
        mtimeMs: 1.5,
        audioMd5: null,
        status: 'present',
        errorMessage: null,
        scanId: scan.id,
      }),
    ).toThrow(/whole milliseconds/);
  });

  it('markFileSeen only advances last_seen_scan_id', () => {
    const root = ensureLibraryRoot(db, '/music');
    const scan1 = newScan(root.id);
    const file = upsertFile(db, {
      rootId: root.id,
      relPath: 'a.flac',
      size: 1,
      mtimeMs: 1,
      audioMd5: 'abc',
      status: 'present',
      errorMessage: null,
      scanId: scan1.id,
    });
    const scan2 = newScan(root.id);
    markFileSeen(db, file.id, scan2.id);
    expect(getFileByPath(db, root.id, 'a.flac')).toEqual({ ...file, lastSeenScanId: scan2.id });
  });
});

describe('artists and genres', () => {
  it('matches names by key and keeps the first spelling', () => {
    const id = upsertArtist(db, 'Björk');
    expect(upsertArtist(db, '  BJORK ')).toBe(id);
    expect(catalog.database.sqlite.prepare('SELECT name FROM artists').all()).toEqual([
      { name: 'Björk' },
    ]);
  });

  it('fills in a sort name later but never overwrites one', () => {
    const id = upsertArtist(db, 'The Cure');
    upsertArtist(db, 'The Cure', 'Cure, The');
    upsertArtist(db, 'the cure', 'Something Else');
    expect(
      catalog.database.sqlite.prepare('SELECT sort_name FROM artists WHERE id = ?').get(id),
    ).toEqual({ sort_name: 'Cure, The' });
  });

  it('rejects empty names', () => {
    expect(() => upsertArtist(db, '   ')).toThrow(/empty/);
    expect(() => upsertGenre(db, '')).toThrow(/empty/);
  });

  it('deduplicates genres by key', () => {
    expect(upsertGenre(db, 'Hip-Hop')).toBe(upsertGenre(db, 'hip-hop'));
    expect(upsertGenre(db, 'Jazz')).not.toBe(upsertGenre(db, 'Hip-Hop'));
  });
});

describe('artwork and albums', () => {
  const cover = {
    sha256: 'a'.repeat(64),
    mime: 'image/jpeg',
    width: 600,
    height: 600,
    byteSize: 1234,
    source: 'embedded',
    cacheFile: `${'a'.repeat(64)}.jpg`,
  } as const;

  it('stores identical artwork once', () => {
    expect(upsertArtwork(db, cover)).toBe(upsertArtwork(db, cover));
    expect(count('artwork')).toBe(1);
  });

  it('merges album data from tracks without erasing known values', () => {
    const artistId = upsertArtist(db, 'Artist');
    const artworkId = upsertArtwork(db, cover);
    const full = {
      groupKey: 'tag:artist|album',
      title: 'Album',
      albumArtistId: artistId,
      year: 1999,
      musicbrainzAlbumId: null,
      totalDiscs: 2,
      artworkId,
    };
    const id = upsertAlbum(db, full);
    // A later track with sparse tags must not clear year, art, or disc count.
    const sparse = { ...full, year: null, totalDiscs: null, artworkId: null, albumArtistId: null };
    expect(upsertAlbum(db, sparse)).toBe(id);

    expect(
      catalog.database.sqlite
        .prepare('SELECT year, total_discs, artwork_id, album_artist_id FROM albums')
        .get(),
    ).toEqual({ year: 1999, total_discs: 2, artwork_id: artworkId, album_artist_id: artistId });
  });

  it('leaves total_discs null when no track knows it', () => {
    const base = {
      groupKey: 'tag:x|y',
      title: 'Y',
      albumArtistId: null,
      year: null,
      musicbrainzAlbumId: null,
      totalDiscs: null,
      artworkId: null,
    };
    upsertAlbum(db, base);
    upsertAlbum(db, base);
    expect(catalog.database.sqlite.prepare('SELECT total_discs FROM albums').get()).toEqual({
      total_discs: null,
    });
  });
});

describe('tracks', () => {
  function setup() {
    const root = ensureLibraryRoot(db, '/music');
    const scan = newScan(root.id);
    const file = upsertFile(db, {
      rootId: root.id,
      relPath: 'a.flac',
      size: 1,
      mtimeMs: 1,
      audioMd5: null,
      status: 'present',
      errorMessage: null,
      scanId: scan.id,
    });
    const values: TrackValues = {
      fileId: file.id,
      segment: 0,
      startMs: null,
      endMs: null,
      albumId: null,
      title: 'Song',
      displayArtist: 'A feat. B',
      trackNo: 1,
      trackTotal: 10,
      discNo: 1,
      discTotal: 1,
      year: 2001,
      durationMs: 180_000,
      codec: 'FLAC',
      container: 'FLAC',
      lossless: true,
      sampleRate: 96_000,
      bitDepth: 24,
      channels: 2,
      bitrate: 3_000_000,
      hasEmbeddedArt: false,
    };
    return { file, values };
  }

  it('creates one track per file and replaces its credits on rescan', () => {
    const { file, values } = setup();
    const a = upsertArtist(db, 'A');
    const b = upsertArtist(db, 'B');
    const rock = upsertGenre(db, 'Rock');

    const id = upsertTrack(db, {
      ...values,
      credits: [
        { artistId: a, role: 'artist' },
        { artistId: b, role: 'artist' },
        { artistId: a, role: 'artist' }, // duplicate tag value
      ],
      genreIds: [rock, rock],
    });
    const again = upsertTrack(db, {
      ...values,
      credits: [{ artistId: b, role: 'artist' }],
      genreIds: [],
    });

    expect(again).toBe(id);
    expect(count('tracks')).toBe(1);
    expect(
      catalog.database.sqlite.prepare('SELECT artist_id, position FROM track_artists').all(),
    ).toEqual([{ artist_id: b, position: 0 }]);
    expect(count('track_genres')).toBe(0);
    expect(getTrackByFileId(db, file.id)?.id).toBe(id);
  });

  it('clears columns whose tags were removed from the file', () => {
    const { file, values } = setup();
    upsertTrack(db, { ...values, credits: [], genreIds: [] });
    upsertTrack(db, { ...values, title: null, year: null, credits: [], genreIds: [] });
    expect(getTrackByFileId(db, file.id)).toMatchObject({ title: null, year: null, codec: 'FLAC' });
  });

  it('rolls back the whole track write if a credit is invalid', () => {
    const { file, values } = setup();
    expect(() =>
      upsertTrack(db, { ...values, credits: [{ artistId: 999, role: 'artist' }], genreIds: [] }),
    ).toThrow(/FOREIGN KEY/);
    expect(getTrackByFileId(db, file.id)).toBeUndefined();
  });
});

describe('id allocation', () => {
  it('does not consume ids when an upsert finds an existing row', () => {
    const root = ensureLibraryRoot(db, '/music');
    ensureLibraryRoot(db, '/music');
    const scan = newScan(root.id);
    const file = {
      rootId: root.id,
      relPath: 'a.flac',
      size: 1,
      mtimeMs: 1,
      audioMd5: null,
      status: 'present',
      errorMessage: null,
      scanId: scan.id,
    } as const;
    for (let i = 0; i < 5; i++) {
      upsertFile(db, { ...file, size: i + 1 });
      upsertArtist(db, 'Same Artist');
      upsertGenre(db, 'Jazz');
      upsertAlbum(db, {
        groupKey: 'tag:x|y',
        title: 'Y',
        albumArtistId: null,
        year: null,
        musicbrainzAlbumId: null,
        totalDiscs: null,
        artworkId: null,
      });
    }
    // The next new row of each kind gets id 2: no ids were burned above.
    expect(ensureLibraryRoot(db, '/other').id).toBe(2);
    expect(upsertFile(db, { ...file, relPath: 'b.flac' }).id).toBe(2);
    expect(upsertArtist(db, 'Another Artist')).toBe(2);
    expect(upsertGenre(db, 'Rock')).toBe(2);
    expect(
      upsertAlbum(db, {
        groupKey: 'tag:x|z',
        title: 'Z',
        albumArtistId: null,
        year: null,
        musicbrainzAlbumId: null,
        totalDiscs: null,
        artworkId: null,
      }),
    ).toBe(2);
  });
});
