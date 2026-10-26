import os from 'node:os';
import path from 'node:path';
import {
  ARTWORK_SUBDIR,
  buildHealthReport,
  createCatalogQueries,
  createLibraryReader,
  loadConfig,
  migrateCatalog,
  openCatalogDatabase,
} from '@sonic-archive/catalog';
import { createApp } from './app.ts';
import { renderScanCopy } from './artwork.ts';
import { createTranscoder } from './audio.ts';
import { startLiveLibrary } from './live.ts';

/** Never configurable: the server only ever listens on loopback (docs/safety.md, #6). */
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;

const port = parsePort(process.env.SONIC_PORT);
const webDist = process.env.SONIC_WEB_DIST;
const { dirs, library } = loadConfig({ env: process.env, homeDir: os.homedir() });

// Create or upgrade the schema with a read-write connection, then serve
// from a read-only one, so no request can modify the catalog.
const writer = openCatalogDatabase(dirs.dataDir);
try {
  const { applied, backupFile } = migrateCatalog(writer);
  if (applied > 0)
    console.log(`applied ${applied} migration(s)${backupFile ? `; backup ${backupFile}` : ''}`);
} finally {
  writer.close();
}
const database = openCatalogDatabase(dirs.dataDir, { readonly: true });

const app = createApp({
  queries: createCatalogQueries(database.sqlite),
  healthReport: () => buildHealthReport(database.sqlite),
  artworkDir: path.join(dirs.cacheDir, ARTWORK_SUBDIR),
  libraryRoot: library.status === 'configured' ? library.root : null,
  // Playback reads library files through the same read-only reader the
  // scanner uses (docs/safety.md).
  library: library.status === 'configured' ? createLibraryReader(library.root) : null,
  transcoder: createTranscoder(),
  ...(webDist !== undefined && { webDist: path.resolve(webDist) }),
});

// `--watch` (pnpm start:watch): follow changes in the library as they happen.
const watch = process.argv.includes('--watch');
let live: ReturnType<typeof startLiveLibrary> | null = null;
let liveDb: ReturnType<typeof openCatalogDatabase> | null = null;
if (watch && library.status === 'configured') {
  liveDb = openCatalogDatabase(dirs.dataDir);
  live = startLiveLibrary({
    db: liveDb.db,
    reader: createLibraryReader(library.root),
    cacheDir: dirs.cacheDir,
    renderScan: renderScanCopy,
    analyze: true,
  });
} else if (watch) {
  console.log('--watch ignored: no library is configured.');
}

const server = app.listen(port, HOST, () => {
  console.log(`Sonic Archive API on http://${HOST}:${port}`);
  if (library.status === 'unconfigured')
    console.log('No library configured yet (see docs/safety.md).');
});

const shutdown = () => {
  live?.close();
  // Open event streams would keep the server from closing.
  server.closeAllConnections();
  server.close(() => {
    liveDb?.close();
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
