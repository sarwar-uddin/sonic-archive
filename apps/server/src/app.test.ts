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
  Statistics,
  Stats,
  TrackListItem,
} from '@sonic-archive/contracts';
import type express from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeLibrary } from './analyze.ts';
import { createApp, fixedLibrary } from './app.ts';
import { renderScanCopy } from './artwork.ts';
import { createTranscoder } from './audio.ts';

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
    {
      db: catalog.database.db,
      reader: createLibraryReader(lib.root),
      cacheDir,
      renderScan: renderScanCopy,
    },
    { mode: 'incremental' },
  );
  await analyzeLibrary({ db: catalog.database.db, reader: createLibraryReader(lib.root) });
  // Serve from a read-only connection, exactly as main.ts does.
  reader = openCatalogDatabase(catalog.dataDir, { readonly: true });
  app = createApp({
    queries: createCatalogQueries(reader.sqlite),
    healthReport: () => buildHealthReport(reader.sqlite),
    artworkDir: path.join(cacheDir, ARTWORK_SUBDIR),
    library: fixedLibrary(lib.root, createLibraryReader(lib.root)),
    transcoder: createTranscoder(),
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
      lastScan: { status: 'completed', seen: 19, errors: 1 },
    });
  });

  it('summarizes the catalog', async () => {
    const body = (await api('/api/stats')).body as Stats;
    // The two CD images count as five tracks.
    expect(body).toMatchObject({ albums: 10, tracks: 21, missingFiles: 0, errorFiles: 1 });
    expect(body.artists).toBe(11); // composers are not counted as artists
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
    expect(body.total).toBe(10);
    expect(titles(body)).toEqual([
      'Loose Copies',
      'Northern Lines',
      'Hi-Res Session',
      'Format Sampler',
      'Double Album',
      'Live Image',
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
        kind: 'loose', // 2 short tracks; see ALBUM_KINDS
        edition: [], // "(2020)" is a year, not an edition
        rip: null, // no rip log
        pressings: 1,
        dr: 0, // steady sine tones
        obi: false,
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
    ['kind=release', ['Format Sampler', 'Live Image']],
    ['kind=loose&q=northern', ['Northern Lines']],
    ['codec=alac', ['Hi-Res Session']],
    ['yearFrom=2010&yearTo=2018', ['Format Sampler', 'Live Image', '夜明け', 'Harbour Lights']],
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
    expect(page2).toMatchObject({ page: 2, limit: 4, total: 10 });
    // Page 1 is Ágætis (sorted as "agaetis"), Double, Format, Harbour.
    expect(titles(page2)).toEqual([
      'Hi-Res Session',
      'Live Image',
      'Loose Copies',
      'Northern Lines',
    ]);
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

  it('lists the tracks of split CD images, counting each file once', async () => {
    const body = (await api(`/api/albums/${await albumId('Live Image')}`)).body as AlbumDetail;
    expect(body.discs.map((d) => [d.discNo, d.tracks.map((t) => t.title)])).toEqual([
      [1, ['Kindling', 'Smoke', 'Ash']],
      [2, ['Embers', 'Daybreak']],
    ]);
    expect(body).toMatchObject({ trackCount: 5, durationMs: 5000, kind: 'release' });
    expect(body.discs[0]?.tracks[1]?.span).toEqual({ startMs: 1000, endMs: 2000 });
    const sizes = new Set(body.discs.flatMap((d) => d.tracks.map((t) => t.file.size)));
    expect(body.totalBytes).toBe([...sizes].reduce((a, b) => a + b, 0));
  });

  it('lists scanned artwork in viewing order, served at reading size', async () => {
    const body = (await api(`/api/albums/${await albumId('Format Sampler')}`)).body as AlbumDetail;
    expect(body.scans).toEqual([
      {
        artworkId: expect.any(Number),
        kind: 'front',
        number: null,
        label: 'Front',
        width: 64,
        height: 64,
      },
      {
        artworkId: expect.any(Number),
        kind: 'back',
        number: null,
        label: 'back',
        width: 64,
        height: 64,
      },
    ]);
    const res = await api(`/api/artwork/${body.scans[1]?.artworkId}?size=xl`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('summarizes rip logs and serves their text', async () => {
    const body = (await api(`/api/albums/${await albumId('Live Image')}`)).body as AlbumDetail;
    // Disc 1 is verified, disc 2 differs: the weaker disc decides.
    expect(body.rip).toBe('differs');
    expect(body.ripLogs).toEqual([
      expect.objectContaining({
        label: 'Ember - Live Image.log',
        disc: 'CD1',
        tool: 'EAC',
        readOffset: 6,
        accurateRip: { accurate: 3, inaccurate: 0, notInDatabase: 0, minConfidence: 9 },
        verdict: 'verified',
      }),
      expect.objectContaining({
        label: 'Ember - Live Image 2.accurip',
        disc: 'CD2',
        verdict: 'differs',
      }),
    ]);
    const log = await api(`/api/rip-logs/${body.ripLogs[0]?.id}`);
    expect(log.body).toMatchObject({ label: 'Ember - Live Image.log', albumId: body.id });
    expect(log.body.text).toMatch(/^Exact Audio Copy V1\.8/);
    expect((await api('/api/rip-logs/999999')).status).toBe(404);
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
    // CD image tracks are 1 s.
    ['durationMin=0.54&durationMax=0.9', ['Lossy']],
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
      {
        id: expect.any(Number),
        name: 'Aurora Field',
        albumCount: 3,
        trackCount: 4,
        artworkIds: [expect.any(Number)], // only Northern Lines has a cover
      },
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
  it('serves covers as WebP at two sizes with immutable caching', async () => {
    const album = (await api(`/api/albums/${await albumId('Northern Lines')}`)).body as AlbumDetail;
    const large = await api(`/api/artwork/${album.artworkId}`).buffer(true);
    expect(large.status).toBe(200);
    expect(large.headers['content-type']).toBe('image/webp');
    expect(large.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const body = large.body as Buffer;
    expect(body.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(body.subarray(8, 12).toString('latin1')).toBe('WEBP');
    // The 64 px fixture is never enlarged.
    expect((await sharp(body).metadata()).width).toBe(64);
    const small = await api(`/api/artwork/${album.artworkId}?size=sm`);
    expect(small.status).toBe(200);
    expect(fs.existsSync(path.join(cacheDir, ARTWORK_SUBDIR, 'derived'))).toBe(true);
  });

  it('converts TIFF scans and shrinks large images', async () => {
    const sha = 'a'.repeat(64);
    await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#7a2b1d' } })
      .tiff()
      .toFile(path.join(cacheDir, ARTWORK_SUBDIR, `${sha}.tif`));
    catalog.database.sqlite
      .prepare(
        `INSERT INTO artwork (sha256, mime, byte_size, source, cache_file)
         VALUES ('${sha}', 'image/tiff', 1, 'folder', '${sha}.tif')`,
      )
      .run();
    const id = (
      catalog.database.sqlite.prepare('SELECT max(id) AS id FROM artwork').get() as { id: number }
    ).id;
    for (const [size, edge] of [
      ['sm', 400],
      ['lg', 1200],
    ] as const) {
      const res = await api(`/api/artwork/${id}?size=${size}`).buffer(true);
      expect(res.headers['content-type']).toBe('image/webp');
      expect((await sharp(res.body as Buffer).metadata()).width).toBe(edge);
    }
  });

  it('serves artwork from a cache inside a dot-directory (~/.cache)', async () => {
    const dotCache = path.join(catalog.dataDir, '.cache', 'sonic-archive', ARTWORK_SUBDIR);
    fs.cpSync(path.join(cacheDir, ARTWORK_SUBDIR), dotCache, { recursive: true });
    const dotApp = createApp({
      queries: createCatalogQueries(reader.sqlite),
      healthReport: () => buildHealthReport(reader.sqlite),
      artworkDir: dotCache,
      library: fixedLibrary(lib.root),
    });
    const album = (await api(`/api/albums/${await albumId('Northern Lines')}`)).body as AlbumDetail;
    const res = await request(dotApp).get(`/api/artwork/${album.artworkId}?size=sm`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('rejects unknown sizes and 404s undecodable files', async () => {
    expect((await api('/api/artwork/1?size=huge')).status).toBe(400);
    const sha = 'b'.repeat(64);
    fs.writeFileSync(path.join(cacheDir, ARTWORK_SUBDIR, `${sha}.jpg`), 'not an image');
    catalog.database.sqlite
      .prepare(
        `INSERT INTO artwork (sha256, mime, byte_size, source, cache_file)
         VALUES ('${sha}', 'image/jpeg', 1, 'folder', '${sha}.jpg')`,
      )
      .run();
    const id = (
      catalog.database.sqlite.prepare('SELECT max(id) AS id FROM artwork').get() as { id: number }
    ).id;
    expect((await api(`/api/artwork/${id}`)).status).toBe(404);
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
      'Live Image',
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
    // The tracks of one CD image share its checksum but are not duplicates.
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
    expect(body.ripChecks.items).toEqual([
      {
        album: { id: expect.any(Number), title: 'Live Image', artist: 'Ember' },
        verdict: 'differs',
        notes: ['Ember - Live Image 2.accurip: 2 of 2 tracks differ from AccurateRip'],
      },
    ]);
  });
});

describe('GET /api/files/:id/audio', () => {
  async function fileOf(title: string) {
    const res = await api(`/api/tracks?q=${encodeURIComponent(title)}`);
    const track = (res.body as Page<TrackListItem>).items.find((t) => t.title === title);
    if (!track) throw new Error(`No track ${title}`);
    return track.file;
  }
  const bytes = (relPath: string) => fs.readFileSync(path.join(lib.root, relPath));
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

  it('streams a FLAC file as stored, with byte ranges for seeking', async () => {
    const file = await fileOf('Polar Night');
    expect(file.playback).toBe('direct');
    const whole = await binary(api(`/api/files/${file.id}/audio`));
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toBe('audio/flac');
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(whole.body, bytes(file.relPath))).toBe(0);

    const part = await binary(api(`/api/files/${file.id}/audio`).set('Range', 'bytes=4-15'));
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 4-15/${file.size}`);
    expect(Buffer.compare(part.body, bytes(file.relPath).subarray(4, 16))).toBe(0);

    const beyond = await api(`/api/files/${file.id}/audio`).set('Range', `bytes=${file.size}-`);
    expect(beyond.status).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${file.size}`);
  });

  it('converts formats browsers cannot play to FLAC while streaming', async () => {
    const file = await fileOf('Coda'); // ALAC in .m4a
    expect(file.playback).toBe('transcode');
    const res = await binary(api(`/api/files/${file.id}/audio?start=0.1`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/flac');
    expect(res.body.subarray(0, 4).toString('latin1')).toBe('fLaC');
  });

  it('answers 503 when too many conversions run, and 404 for a vanished file', async () => {
    const busy = createApp({
      queries: createCatalogQueries(reader.sqlite),
      healthReport: () => buildHealthReport(reader.sqlite),
      artworkDir: path.join(cacheDir, ARTWORK_SUBDIR),
      library: fixedLibrary(lib.root, {
        audioFile: async () => ({ absolute: '/nowhere', size: 1 }),
        readAudioRange: async () => {
          throw new Error('unused');
        },
      }),
      transcoder: { stream: () => null },
    });
    const coda = await fileOf('Coda');
    expect((await request(busy).get(`/api/files/${coda.id}/audio`)).status).toBe(503);

    const gone = createApp({
      queries: createCatalogQueries(reader.sqlite),
      healthReport: () => buildHealthReport(reader.sqlite),
      artworkDir: path.join(cacheDir, ARTWORK_SUBDIR),
      library: fixedLibrary(lib.root, {
        audioFile: async () => {
          throw new Error('ENOENT');
        },
        readAudioRange: async () => {
          throw new Error('unused');
        },
      }),
    });
    expect((await request(gone).get(`/api/files/${coda.id}/audio`)).status).toBe(404);
  });

  it('refuses unknown files and bad parameters', async () => {
    expect((await api('/api/files/999999/audio')).status).toBe(404);
    const file = await fileOf('Polar Night');
    expect((await api(`/api/files/${file.id}/audio?start=-1`)).status).toBe(400);
    expect((await api(`/api/files/${file.id}/audio?path=/etc/passwd`)).status).toBe(400);
  });
});

describe('changing things: write protection', () => {
  const TOKEN = 'test-token-0123456789';
  const changes: string[] = [];
  const writable = createApp({
    queries: createCatalogQueries(createTempCatalog().database.sqlite),
    healthReport: () => ({}) as HealthReport,
    artworkDir: '/nonexistent',
    sessionToken: TOKEN,
    library: {
      ...fixedLibrary('/music'),
      setRoot: async (p) => {
        changes.push(`root ${p}`);
        return fixedLibrary(p).status();
      },
      rescan: (full) => {
        changes.push(`rescan ${full}`);
        return fixedLibrary('/music').status();
      },
      setWatching: (on) => {
        changes.push(`watch ${on}`);
        return fixedLibrary('/music').status();
      },
    },
  });
  const put = (url: string) => request(writable).put(url).set('Host', '127.0.0.1:4317');

  it('accepts a change from the app: same origin, token, JSON', async () => {
    const res = await put('/api/library')
      .set('Origin', 'http://127.0.0.1:4317')
      .set('X-Sonic-Token', TOKEN)
      .send({ path: '/srv/music' });
    expect(res.status).toBe(200);
    expect(res.body.root).toBe('/srv/music');
    expect(changes).toContain('root /srv/music');
  });

  it.each([
    ['no Origin', {}, 403],
    ['another site', { Origin: 'http://evil.example' }, 403],
    ['the same host on another port', { Origin: 'http://127.0.0.1:9999' }, 403],
    ['no token', { Origin: 'http://127.0.0.1:4317', 'X-Sonic-Token': '' }, 403],
    ['a wrong token', { Origin: 'http://127.0.0.1:4317', 'X-Sonic-Token': 'x'.repeat(21) }, 403],
  ])('refuses a change with %s', async (_, headers, status) => {
    const before = changes.length;
    const res = await put('/api/library')
      .set(headers as Record<string, string>)
      .send({ path: '/x' });
    expect(res.status).toBe(status);
    expect(changes).toHaveLength(before);
  });

  it('refuses form posts and unknown body fields', async () => {
    const headers = { Origin: 'http://127.0.0.1:4317', 'X-Sonic-Token': TOKEN };
    const form = await put('/api/library').set(headers).type('form').send('path=/x');
    expect(form.status).toBe(415);
    const extra = await put('/api/library').set(headers).send({ path: '/x', admin: true });
    expect(extra.status).toBe(400);
  });

  it('still refuses every other change request', async () => {
    const headers = { Origin: 'http://127.0.0.1:4317', 'X-Sonic-Token': TOKEN };
    expect((await request(writable).delete('/api/library').set(headers)).status).toBe(405);
    expect((await request(writable).post('/api/albums/1').set(headers).send({})).status).toBe(405);
  });

  it('gives the page its token, and lists folders', async () => {
    expect((await request(writable).get('/api/session')).body).toEqual({ token: TOKEN });
    const res = await request(writable).get(`/api/folders?path=${encodeURIComponent(lib.root)}`);
    expect(res.status).toBe(200);
    expect(res.body.folders.map((f: { name: string }) => f.name)).toContain('Aurora Field');
    expect((await request(writable).get('/api/folders?path=relative')).body.error.code).toBe(
      'INVALID_FOLDER',
    );
  });
});

describe('GET /api/events', () => {
  it('says "no scan yet" on a new install', async () => {
    const fresh = createTempCatalog();
    const freshReader = openCatalogDatabase(fresh.dataDir, { readonly: true });
    const server = createApp({
      queries: createCatalogQueries(freshReader.sqlite),
      healthReport: () => buildHealthReport(freshReader.sqlite),
      artworkDir: '/nonexistent',
      library: fixedLibrary(null),
    }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const controller = new AbortController();
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
      const reader = res.body?.getReader();
      let text = '';
      while (reader && !/event: scan\ndata: null/.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      expect(text).toMatch(/event: scan\ndata: null/);
      expect(text).toMatch(/event: library\ndata: \{"root":null,/);
    } finally {
      controller.abort();
      server.closeAllConnections();
      server.close();
      freshReader.close();
      fresh.cleanup();
    }
  });

  it('announces the last scan, then each newly finished one', async () => {
    // Its own catalog: this test adds a scan.
    const own = createTempCatalog();
    const ownCache = path.join(own.dataDir, 'cache');
    const scanOwn = () =>
      runScan(
        { db: own.database.db, reader: createLibraryReader(lib.root), cacheDir: ownCache },
        { mode: 'incremental' },
      );
    await scanOwn();
    const ownReader = openCatalogDatabase(own.dataDir, { readonly: true });
    const events = createApp({
      queries: createCatalogQueries(ownReader.sqlite),
      healthReport: () => buildHealthReport(ownReader.sqlite),
      artworkDir: path.join(ownCache, ARTWORK_SUBDIR),
      library: fixedLibrary(lib.root),
      eventsPollMs: 30,
    });
    const server = events.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as { port: number };
    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      const stream = res.body?.getReader();
      if (!stream) throw new Error('no body');
      const decoder = new TextDecoder();
      let text = '';
      const next = async (pattern: RegExp) => {
        while (!pattern.test(text)) {
          const { value, done } = await stream.read();
          if (done) throw new Error('stream ended');
          text += decoder.decode(value);
        }
      };
      await next(/event: library\ndata: \{"root":/);
      await next(/event: scan\ndata: \{"id":1,/);
      // Another scan finishes (here: the CLI's, on the write connection).
      await scanOwn();
      await next(/data: \{"id":2,/);
    } finally {
      controller.abort();
      server.closeAllConnections();
      server.close();
      ownReader.close();
      own.cleanup();
    }
  });
});

describe('GET /api/statistics', () => {
  it('describes the releases: decades, genres, artists and rip verdicts', async () => {
    const body = (await api('/api/statistics')).body as Statistics;
    // Only Format Sampler (4 tracks) and Live Image (5) count as releases.
    expect(body).toEqual({
      releases: 2,
      decades: [{ decade: 2010, releases: 2 }],
      undated: 0,
      origins: [],
      genres: [{ id: expect.any(Number), name: 'Post-Rock', releases: 1 }],
      artists: [
        { id: expect.any(Number), name: 'Cinder Collective', releases: 1 },
        { id: expect.any(Number), name: 'Ember', releases: 1 },
      ],
      dynamicsByDecade: [{ decade: 2010, dr: expect.any(Number), releases: 2 }],
      rips: [
        { verdict: 'differs', releases: 1 },
        { verdict: 'none', releases: 1 },
      ],
    });
  });
});

describe('scans', () => {
  it('lists scan history', async () => {
    const res = await api('/api/scans');
    expect(res.body).toEqual([
      expect.objectContaining({ id: 1, status: 'completed', mode: 'incremental', seen: 19 }),
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
        library: fixedLibrary(copy.root),
      });
      const albums = (await request(missingApp).get('/api/albums')).body as Page<AlbumSummary>;
      expect(titles(albums)).not.toContain('Untagged');
      const stats = (await request(missingApp).get('/api/stats')).body as Stats;
      expect(stats).toMatchObject({ tracks: 20, missingFiles: 1 });
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
        library: fixedLibrary(lib.root),
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
