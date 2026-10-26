import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { upsertAlbum, upsertArtist, upsertGenre, upsertTrack } from './catalog-repository.ts';
import { ensureLibraryRoot, startScan, upsertFile } from './library-repository.ts';
import { rebuildSearchIndex, toFtsQuery } from './search-index.ts';
import { createTempCatalog, type TempCatalog } from './test-support.ts';

describe('toFtsQuery', () => {
  it.each([
    ['sigur ros', '"sigur"* "ros"*'],
    ['  AC/DC ', '"AC"* "DC"*'],
    ['"quoted" NEAR(x y) -neg *', '"quoted"* "NEAR"* "x"* "y"* "neg"*'],
    ['夜明け', '"夜明け"*'],
    ['ＡＢＣ', '"ABC"*'],
  ])('%s -> %s', (input, expected) => {
    expect(toFtsQuery(input)).toBe(expected);
  });

  it('returns null when nothing searchable remains', () => {
    expect(toFtsQuery(' "*-() ')).toBeNull();
  });

  it('caps the number of terms', () => {
    expect(toFtsQuery('a b c d e f g h i j')?.split(' ')).toHaveLength(8);
  });
});

describe('rebuildSearchIndex', () => {
  let catalog: TempCatalog;

  beforeEach(() => {
    catalog = createTempCatalog();
    const db = catalog.database.db;
    const root = ensureLibraryRoot(db, '/music');
    const scan = startScan(db, {
      rootId: root.id,
      mode: 'full',
      scopeSubpath: null,
      startedAt: new Date(),
    });
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
    const artistId = upsertArtist(db, 'Sigur Rós');
    const guestId = upsertArtist(db, 'Guest Star');
    const albumId = upsertAlbum(db, {
      groupKey: 'tag:sigur ros|agaetis byrjun',
      title: 'Ágætis byrjun',
      albumArtistId: artistId,
      year: 1999,
      musicbrainzAlbumId: null,
      totalDiscs: null,
      artworkId: null,
    });
    upsertTrack(db, {
      fileId: file.id,
      albumId,
      title: 'Svefn-g-englar',
      displayArtist: 'Sigur Rós',
      trackNo: 1,
      trackTotal: null,
      discNo: null,
      discTotal: null,
      year: 1999,
      durationMs: 1,
      codec: 'FLAC',
      container: 'FLAC',
      lossless: true,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      bitrate: 1,
      hasEmbeddedArt: false,
      credits: [
        { artistId, role: 'artist' },
        { artistId: guestId, role: 'artist' },
      ],
      genreIds: [upsertGenre(db, 'Post-Rock')],
    });
    rebuildSearchIndex(db);
  });

  afterEach(() => {
    catalog.cleanup();
  });

  function search(input: string): number[] {
    const query = toFtsQuery(input);
    return (
      catalog.database.sqlite
        .prepare('SELECT rowid FROM track_search WHERE track_search MATCH ?')
        .all(query) as { rowid: number }[]
    ).map((r) => r.rowid);
  }

  it.each(['svefn', 'sigur ros', 'agætis', 'ÁGÆTIS', 'guest', 'post rock', 'sig'])(
    'finds the track by "%s"',
    (input) => {
      expect(search(input)).toEqual([1]);
    },
  );

  it('folds accents but not distinct letters such as æ', () => {
    // Æ is a letter, not A plus a diacritic, so "agaetis" is a different word.
    expect(search('agaetis')).toEqual([]);
  });

  it('requires every term to match', () => {
    expect(search('sigur nothing')).toEqual([]);
  });

  it('is idempotent', () => {
    rebuildSearchIndex(catalog.database.db);
    expect(search('svefn')).toEqual([1]);
  });
});
