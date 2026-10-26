import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARTWORK_SUBDIR,
  buildHealthReport,
  type CatalogDatabase,
  createCatalogQueries,
  createLibraryReader,
  openCatalogDatabase,
  runScan,
} from '@sonic-archive/catalog';
import {
  copyFixtureLibrary,
  createTempCatalog,
  type LibraryCopy,
  type TempCatalog,
} from '@sonic-archive/catalog/testing';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  Facets,
  Health,
  HealthReport,
  Page,
  SearchResults,
  Stats,
  TrackListItem,
} from '@sonic-archive/contracts';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let catalog: TempCatalog;
let lib: LibraryCopy;
let reader: CatalogDatabase;
let cacheDir: string;
let app: express.Express;

beforeAll(async () => {
  catalog = createTempCatalog();
  lib = copyFixtureLibrary();
  cacheDir = path.join(catalog.dataDir, 'cache');
  await runScan(
    { db: catalog.database.db, reader: createLibraryReader(lib.root), cacheDir },
    { mode: 'incremental' },
  );
  // Serve from a read-only connection, exactly as main.ts does.
  reader = openCatalogDatabase(catalog.dataDir, { readonly: true });
  app = createApp({
    queries: createCatalogQueries(reader.sqlite),
    healthReport: () => buildHealthReport(reader.sqlite),
    artworkDir: path.join(cacheDir, ARTWORK_SUBDIR),
    libraryRoot: lib.root,
  });
});

afterAll(() => {
  reader.close();
  lib.cleanup();
  catalog.cleanup();
});

const api = (url: string) => request(app).get(url);
const titles = (page: Page<AlbumSummary>) => page.items.map((a) => a.title);

async function albumId(title: string): Promise<number> {
  const res = await api(`/api/albums?limit=100`);
  const album = (res.body as Page<AlbumSummary>).items.find((a) => a.title === title);
  if (!album) throw new Error(`No album ${title}`);
  return album.id;
}

describe('security', () => {
  it.each(['evil.example', 'evil.example:4317', '127.0.0.1.evil.example', 'localhost.evil:80'])(
    'refuses Host %s (DNS rebinding)',
    async (host) => {
      const res = await api('/api/health').set('Host', host);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Host not allowed.' } });
    },
  );

  it.each(['localhost:5173', '127.0.0.1:4317', '[::1]:4317', 'LOCALHOST'])(
    'accepts loopback Host %s',
    async (host) => {
      expect((await api('/api/health').set('Host', host)).status).toBe(200);
    },
  );

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'refuses %s: the API is read-only',
    async (m) => {
      const res = await request(app)[m]('/api/albums');
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    },
  );

  it('sends protective headers and never CORS headers', async () => {
    const res = await api('/api/stats').set('Origin', 'https://evil.example');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    '/api/albums?path=/etc/passwd',
    '/api/tracks?file=../../x',
    '/api/albums?limit=1000',
    '/api/albums?lossless=yes',
    '/api/albums?q=',
    '/api/albums?q=a&q=b',
    '/api/albums?sort=title;DROP TABLE albums',
    '/api/albums/abc',
    '/api/albums/1.5',
    '/api/albums/..%2F..%2Fetc',
    '/api/artwork/-1',
  ])('rejects %s with 400', async (url) => {
    const res = await api(url);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('answers unknown API routes with JSON 404', async () => {
    const res = await api('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});

describe('GET /api/health and /api/stats', () => {
  it('reports library status and the last scan', async () => {
    const body = (await api('/api/health')).body as Health;
    expect(body).toMatchObject({
      status: 'ok',
      library: { configured: true, available: true },
      lastScan: { status: 'completed', seen: 17, errors: 1 },
    });
  });

  it('summarizes the catalog', async () => {
    const body = (await api('/api/stats')).body as Stats;
    expect(body).toMatchObject({ albums: 9, tracks: 16, missingFiles: 0, errorFiles: 1 });
    expect(body.artists).toBe(9); // composers are not counted as artists
    expect(body.formats).toContainEqual({
      codec: 'FLAC',
      sampleRate: 96000,
      bitDepth: 24,
      trackCount: 1,
    });
  });
});

describe('GET /api/albums', () => {
  it('lists albums sorted by artist by default', async () => {
    const body = (await api('/api/albums')).body as Page<AlbumSummary>;
    expect(body.total).toBe(9);
    expect(titles(body)).toEqual([
      'Loose Copies',
      'Northern Lines',
      'Hi-Res Session',
      'Format Sampler',
      'Double Album',
      'Ágætis Morgunn', // "Ísold" sorts with I, not after Z
      '夜明け',
      'Harbour Lights',
      'Untagged', // no album artist: last
    ]);
  });

  it('summarizes each album', async () => {
    const body = (await api('/api/albums?q=hi-res')).body as Page<AlbumSummary>;
    expect(body.items).toEqual([
      {
        id: expect.any(Number),
        title: 'Hi-Res Session',
        albumArtist: { id: expect.any(Number), name: 'Basalt Quartet' },
        year: 2020,
        artworkId: expect.any(Number),
        trackCount: 2,
        durationMs: 750,
        codecs: expect.arrayContaining(['FLAC', 'ALAC']),
        maxSampleRate: 96000,
        maxBitDepth: 24,
        lossless: true,
      },
    ]);
  });

  it.each([
    ['q=northern', ['Northern Lines']],
    ['q=sigur', []],
    ['q=isold', ['Ágætis Morgunn']],
    ['q=%22*', []],
    ['lossless=false', ['Format Sampler']],
    ['minSampleRate=96000', ['Hi-Res Session']],
    ['minBitDepth=24', ['Hi-Res Session']],
    ['codec=alac', ['Hi-Res Session']],
    ['yearFrom=2010&yearTo=2018', ['Format Sampler', '夜明け', 'Harbour Lights']],
  ])('filters by %s', async (query, expected) => {
    expect(titles((await api(`/api/albums?${query}`)).body)).toEqual(expected);
  });

  it('filters by artist, including albums where the artist only appears', async () => {
    const artists = (await api('/api/artists?q=aurora')).body as Page<ArtistSummary>;
    const id = artists.items[0]?.id;
    expect(titles((await api(`/api/albums?artistId=${id}`)).body)).toEqual([
      'Loose Copies',
      'Northern Lines',
      'Harbour Lights',
    ]);
  });

  it('filters by genre', async () => {
    const facets = (await api('/api/facets')).body as Facets;
    const ambient = facets.genres.find((g) => g.name === 'Ambient');
    expect(titles((await api(`/api/albums?genreId=${ambient?.id}`)).body)).toEqual([
      'Northern Lines',
    ]);
  });

  it('sorts and paginates', async () => {
    const byYear = (await api('/api/albums?sort=year&order=desc&limit=3'))
      .body as Page<AlbumSummary>;
    expect(byYear.items.map((a) => a.year)).toEqual([2020, 2018, 2015]);
    const page2 = (await api('/api/albums?sort=title&limit=4&page=2')).body as Page<AlbumSummary>;
    expect(page2).toMatchObject({ page: 2, limit: 4, total: 9 });
    // Page 1 is Ágætis (sorted as "agaetis"), Double, Format, Harbour.
    expect(titles(page2)).toEqual(['Hi-Res Session', 'Loose Copies', 'Northern Lines', 'Untagged']);
  });
});

describe('GET /api/albums/:id', () => {
  it('returns discs, tracks, genres and technical details', async () => {
    const body = (await api(`/api/albums/${await albumId('Double Album')}`)).body as AlbumDetail;
    expect(body).toMatchObject({
      title: 'Double Album',
      totalDiscs: 2,
      musicbrainzAlbumId: '11111111-2222-4333-8444-555555555555',
      genres: [],
    });
    expect(body.discs.map((d) => [d.discNo, d.tracks.map((t) => t.title)])).toEqual([
      [1, ['Side A']],
      [2, ['Side C']],
    ]);
    expect(body.discs[0]?.tracks[0]).toMatchObject({
      codec: 'FLAC',
      sampleRate: 44100,
      bitDepth: 16,
      hasEmbeddedArt: true,
      artists: [{ id: expect.any(Number), name: 'Drift' }],
      file: { relPath: 'Drift/Double Album (1999)/CD1/01 Side A.flac', status: 'present' },
    });
    expect(body.totalBytes).toBeGreaterThan(0);
  });

  it('404s for an unknown album', async () => {
    expect((await api('/api/albums/999999')).status).toBe(404);
  });
});

describe('GET /api/tracks', () => {
  it.each([
    ['bitDepth=24', ['Overture']],
    ['q=duet', ['Duet']],
    ['codec=opus', ['Open']],
    // Fixture tones are 0.25–0.5 s; only the MP3 is longer (encoder padding).
    ['durationMin=0.54', ['Lossy']],
    ['durationMax=0.3', ['Overture']],
  ])('filters by %s', async (query, expected) => {
    const body = (await api(`/api/tracks?${query}`)).body as Page<TrackListItem>;
    expect(body.items.map((t) => t.title)).toEqual(expected);
  });

  it('includes the album and credits for each track', async () => {
    const body = (await api('/api/tracks?q=duet')).body as Page<TrackListItem>;
    expect(body.items[0]).toMatchObject({
      displayArtist: 'Echo Park, Fen Lowe',
      artists: [
        { id: expect.any(Number), name: 'Echo Park' },
        { id: expect.any(Number), name: 'Fen Lowe' },
      ],
      album: { title: 'Harbour Lights' },
    });
  });

  it('sorts by sample rate', async () => {
    const body = (await api('/api/tracks?sort=sampleRate&order=desc&limit=2'))
      .body as Page<TrackListItem>;
    expect(body.items.map((t) => t.sampleRate)).toEqual([96000, 48000]);
  });
});

describe('artists', () => {
  it('lists artists with album and track counts', async () => {
    const body = (await api('/api/artists?q=AURORA')).body as Page<ArtistSummary>;
    expect(body.items).toEqual([
      { id: expect.any(Number), name: 'Aurora Field', albumCount: 3, trackCount: 4 },
    ]);
  });

  it('separates own albums from appearances', async () => {
    const list = (await api('/api/artists?q=aurora')).body as Page<ArtistSummary>;
    const body = (await api(`/api/artists/${list.items[0]?.id}`)).body as ArtistDetail;
    expect(body.albums.map((a) => a.title)).toEqual(['Northern Lines', 'Loose Copies']);
    expect(body.appearsOn.map((a) => a.title)).toEqual(['Harbour Lights']);
  });

  it('404s for an unknown artist', async () => {
    expect((await api('/api/artists/999999')).status).toBe(404);
  });
});

describe('GET /api/search', () => {
  it('groups results by albums, artists and tracks', async () => {
    const body = (await api('/api/search?q=aurora')).body as SearchResults;
    expect(body.artists.map((a) => a.name)).toEqual(['Aurora Field']);
    expect(body.albums.map((a) => a.title)).toEqual([
      'Loose Copies',
      'Northern Lines',
      'Harbour Lights',
    ]);
    expect(body.tracks.map((t) => t.title).sort()).toEqual([
      'First Light',
      'First Light (copy)',
      'Polar Night',
      'Signal',
    ]);
  });

  it('treats FTS syntax as plain text', async () => {
    const res = await api('/api/search?q=%22%20NEAR(%20*');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ albums: [], tracks: [] });
  });
});

describe('GET /api/artwork/:id', () => {
  it('serves cached artwork with immutable caching', async () => {
    const album = (await api(`/api/albums/${await albumId('Northern Lines')}`)).body as AlbumDetail;
    const res = await api(`/api/artwork/${album.artworkId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body[0]).toBe(0xff);
  });

  it('404s for unknown artwork', async () => {
    expect((await api('/api/artwork/999999')).status).toBe(404);
  });

  it('refuses a tampered cache file name instead of following it', async () => {
    const secret = path.join(catalog.dataDir, 'secret.txt');
    fs.writeFileSync(secret, 'top secret');
    catalog.database.sqlite
      .prepare(
        `INSERT INTO artwork (sha256, mime, byte_size, source, cache_file)
         VALUES ('${'f'.repeat(64)}', 'image/jpeg', 1, 'folder', '../../secret.txt')`,
      )
      .run();
    const id = (
      catalog.database.sqlite.prepare('SELECT max(id) AS id FROM artwork').get() as { id: number }
    ).id;
    const res = await api(`/api/artwork/${id}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('top secret');
  });
});

describe('GET /api/health-report', () => {
  it("reports the fixture library's problems", async () => {
    const body = (await api('/api/health-report')).body as HealthReport;
    expect(body.missingFiles).toEqual({ total: 0, items: [] });
    expect(body.unreadableFiles.items).toEqual([
      { relPath: 'Broken/garbage.flac', error: expect.stringMatching(/FLAC/) },
    ]);
    expect(body.missingArtwork.items.map((a) => a.title)).toEqual([
      'Ágætis Morgunn', // locale-aware: sorts with A
      'Harbour Lights',
      'Loose Copies',
      'Untagged',
      '夜明け',
    ]);
    expect(body.metadataIssues.items).toContainEqual({
      album: { id: expect.any(Number), title: 'Untagged', artist: null },
      issues: [
        'No album tag: grouped by folder',
        '1 track without a title',
        '1 track without an artist',
        '1 track without a track number',
        'No year',
      ],
    });
    expect(body.exactDuplicates.items).toEqual([
      {
        audioMd5: 'f92951abe8308de3f54a91cda07e7faa',
        tracks: [
          expect.objectContaining({
            title: 'First Light',
            relPath: expect.stringContaining('Northern Lines'),
          }),
          expect.objectContaining({ title: 'First Light (copy)' }),
        ],
      },
    ]);
    expect(body.probableDuplicates.total).toBe(0);
    expect(body.splitAlbums.total).toBe(0);
  });
});

describe('scans', () => {
  it('lists scan history', async () => {
    const res = await api('/api/scans');
    expect(res.body).toEqual([
      expect.objectContaining({ id: 1, status: 'completed', mode: 'incremental', seen: 17 }),
    ]);
    expect((await api('/api/scans/1')).body.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((await api('/api/scans/99')).status).toBe(404);
  });
});

describe('missing files', () => {
  it('are hidden from browsing but keep their rows', async () => {
    const other = createTempCatalog();
    const copy = copyFixtureLibrary();
    try {
      const deps = {
        db: other.database.db,
        reader: createLibraryReader(copy.root),
        cacheDir: path.join(other.dataDir, 'cache'),
      };
      await runScan(deps, { mode: 'incremental' });
      fs.rmSync(path.join(copy.root, 'Untagged/unknown.flac'));
      await runScan(deps, { mode: 'incremental' });
      const missingApp = createApp({
        queries: createCatalogQueries(other.database.sqlite),
        healthReport: () => buildHealthReport(other.database.sqlite),
        artworkDir: path.join(other.dataDir, 'cache', ARTWORK_SUBDIR),
        libraryRoot: copy.root,
      });
      const albums = (await request(missingApp).get('/api/albums')).body as Page<AlbumSummary>;
      expect(titles(albums)).not.toContain('Untagged');
      const stats = (await request(missingApp).get('/api/stats')).body as Stats;
      expect(stats).toMatchObject({ tracks: 15, missingFiles: 1 });
    } finally {
      copy.cleanup();
      other.cleanup();
    }
  });
});

describe('production web app', () => {
  it('serves the app shell for client routes but never for /api', async () => {
    const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-web-'));
    fs.writeFileSync(
      path.join(webDist, 'index.html'),
      '<!doctype html><title>Sonic Archive</title>',
    );
    try {
      const webApp = createApp({
        queries: createCatalogQueries(reader.sqlite),
        healthReport: () => buildHealthReport(reader.sqlite),
        artworkDir: path.join(cacheDir, ARTWORK_SUBDIR),
        libraryRoot: lib.root,
        webDist,
      });
      const page = await request(webApp).get('/albums/3');
      expect(page.status).toBe(200);
      expect(page.text).toContain('<title>Sonic Archive</title>');
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
      expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect((await request(webApp).get('/api/missing')).status).toBe(404);
    } finally {
      fs.rmSync(webDist, { recursive: true, force: true });
    }
  });
});
