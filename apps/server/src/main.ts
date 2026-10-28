import os from 'node:os';
import path from 'node:path';
import {
  ARTWORK_SUBDIR,
  buildHealthReport,
  createCatalogQueries,
  loadConfig,
  migrateCatalog,
  openCatalogDatabase,
} from '@sonic-archive/catalog';
import { createApp } from './app.ts';
import { renderScanCopy } from './artwork.ts';
import { createTranscoder } from './audio.ts';
import { FFMPEG_MISSING, findFfmpeg } from './ffmpeg.ts';
import { createLibraryService } from './library-service.ts';

/** Never configurable: the server only ever listens on loopback (docs/safety.md, #6). */
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;

const port = parsePort(process.env.SONIC_PORT);
const webDist = process.env.SONIC_WEB_DIST;
const homeDir = os.homedir();
const { dirs, library, settings } = loadConfig({ env: process.env, homeDir });

// Create or upgrade the schema with a read-write connection that is kept
// for scanning only. Requests are served from a read-only connection, so no
// request handler can modify the catalog.
const writer = openCatalogDatabase(dirs.dataDir);
const { applied, backupFile } = migrateCatalog(writer);
if (applied > 0)
  console.log(`applied ${applied} migration(s)${backupFile ? `; backup ${backupFile}` : ''}`);
const database = openCatalogDatabase(dirs.dataDir, { readonly: true });

// ffmpeg is optional: without it, dynamic range and converted playback are off.
const ffmpeg = await findFfmpeg();
if (!ffmpeg) console.log(FFMPEG_MISSING);

// The music folder: chosen in the app (or config.json / SONIC_LIBRARY_ROOT),
// scanned when the app starts and, if watching is on, whenever it changes.
const libraryService = createLibraryService({
  env: process.env,
  homeDir,
  dirs,
  initial: library,
  settings,
  database: writer,
  renderScan: renderScanCopy,
  analyze: ffmpeg,
});

const app = createApp({
  queries: createCatalogQueries(database.sqlite),
  healthReport: () => buildHealthReport(database.sqlite),
  artworkDir: path.join(dirs.cacheDir, ARTWORK_SUBDIR),
  library: libraryService,
  homeDir,
  ...(ffmpeg && { transcoder: createTranscoder() }),
  ...(webDist !== undefined && { webDist: path.resolve(webDist) }),
});

const server = app.listen(port, HOST, () => {
  console.log(`Sonic Archive on http://${HOST}:${port}`);
  if (library.status === 'unconfigured')
    console.log('No music folder yet: open the app to choose one.');
});

const shutdown = () => {
  // Open event streams would keep the server from closing.
  server.closeAllConnections();
  server.close(async () => {
    await libraryService.close();
    writer.close();
    database.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error(`SONIC_PORT must be an integer between 1024 and 65535 (got "${value}").`);
  }
  return n;
}
