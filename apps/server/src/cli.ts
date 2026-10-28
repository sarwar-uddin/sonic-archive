import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CONFIG_FILE_NAME,
  ConfigError,
  createLibraryReader,
  loadConfig,
  migrateCatalog,
  openCatalogDatabase,
  PathSafetyError,
  resolveAppDirs,
  runScan,
  type ScanSummary,
} from '@sonic-archive/catalog';
import { analyzeLibrary } from './analyze.ts';
import { renderScanCopy } from './artwork.ts';
import { findFfmpeg } from './ffmpeg.ts';

const USAGE = `Usage: sonic-archive <command> [options]

Commands:
  paths     Show where Sonic Archive stores its config, database, and cache
  migrate   Create or upgrade the catalog database (backs up first)
  scan      Index the configured music library (read-only)
  analyze   Measure dynamic range by decoding audio (read-only; needs ffmpeg)

Scan options:
  --confirm              Required to actually read the library
  --subpath <folder>     Only scan this folder (relative to the library root)
  --full                 Re-read every file, not just new or changed ones
  --dry-run              List and compare files without reading their contents
  --allow-mass-missing   Permit marking many files missing in one scan

Analyze options:
  --confirm              Required to actually read the library
  --subpath <folder>     Only analyze this folder (relative to the library root)

Analysis only measures tracks that are new or whose files changed.`;

const EXIT = { ok: 0, usage: 1, config: 2, aborted: 3, failed: 4 } as const;

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case 'paths':
      paths();
      break;
    case 'migrate':
      migrate();
      break;
    case 'scan':
      process.exitCode = await scan(rest);
      break;
    case 'analyze':
      process.exitCode = await analyze(rest);
      break;
    default:
      console.error(USAGE);
      process.exitCode = command === undefined ? EXIT.ok : EXIT.usage;
  }
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error (${error.code}): ${error.message}`);
    process.exitCode = EXIT.config;
  } else if (error instanceof PathSafetyError) {
    console.error(`Refused (${error.code}): ${error.message}`);
    process.exitCode = EXIT.usage;
  } else {
    throw error;
  }
}

function paths(): void {
  // Deliberately does not load or validate the library root: this command
  // must never touch the music collection.
  const dirs = resolveAppDirs(process.env, os.homedir());
  console.log(`config  ${dirs.configDir}`);
  console.log(`data    ${dirs.dataDir}`);
  console.log(`cache   ${dirs.cacheDir}`);
}

function migrate(): void {
  // Loading the config validates any configured root (realpath + stat of
  // the root only), so an unsafe setup is caught before the DB is created.
  const { dirs } = loadConfig({ env: process.env, homeDir: os.homedir() });
  const database = openCatalogDatabase(dirs.dataDir);
  try {
    const { applied, backupFile } = migrateCatalog(database);
    console.log(`database  ${database.file}`);
    console.log(applied === 0 ? 'up to date' : `applied ${applied} migration(s)`);
    if (backupFile) console.log(`backup    ${backupFile}`);
  } finally {
    database.close();
  }
}

async function scan(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      confirm: { type: 'boolean', default: false },
      subpath: { type: 'string' },
      full: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'allow-mass-missing': { type: 'boolean', default: false },
    },
  });

  const { dirs, library } = loadConfig({ env: process.env, homeDir: os.homedir() });
  if (library.status === 'unconfigured') {
    console.error(
      `No music library is configured.\nAdd {"libraryRoot": "/absolute/path/to/Music"} to ` +
        `${path.join(dirs.configDir, CONFIG_FILE_NAME)} (see docs/safety.md).`,
    );
    return EXIT.config;
  }

  const mode = values.full ? 'full' : 'incremental';
  const plan = [
    `library  ${library.root}`,
    `scope    ${values.subpath ?? '(entire library)'}`,
    `mode     ${values['dry-run'] ? 'dry run (no file contents read, catalog unchanged)' : mode}`,
  ].join('\n');

  if (!values.confirm) {
    console.log(`${plan}\n\nNothing has been read. Re-run with --confirm to proceed.`);
    return EXIT.usage;
  }
  console.log(plan);

  const database = openCatalogDatabase(dirs.dataDir);
  const controller = new AbortController();
  const onSigint = () => {
    console.error('\nStopping after the files in progress… (nothing will be marked missing)');
    controller.abort();
  };
  process.once('SIGINT', onSigint);

  try {
    migrateCatalog(database);
    const summary = await runScan(
      {
        db: database.db,
        reader: createLibraryReader(library.root),
        cacheDir: dirs.cacheDir,
        renderScan: renderScanCopy,
      },
      {
        mode,
        ...(values.subpath !== undefined && { subpath: values.subpath }),
        dryRun: values['dry-run'],
        allowMassMissing: values['allow-mass-missing'],
        signal: controller.signal,
        onProgress: progressPrinter(),
        onScansProgress: scansProgressPrinter(),
      },
    );
    printSummary(summary);
    return summary.status === 'completed' || summary.status === 'dry-run'
      ? EXIT.ok
      : summary.status === 'aborted'
        ? EXIT.aborted
        : EXIT.failed;
  } finally {
    process.off('SIGINT', onSigint);
    database.close();
  }
}

async function analyze(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      confirm: { type: 'boolean', default: false },
      subpath: { type: 'string' },
    },
  });
  const { dirs, library } = loadConfig({ env: process.env, homeDir: os.homedir() });
  if (library.status === 'unconfigured') {
    console.error('No music library is configured (see docs/safety.md).');
    return EXIT.config;
  }
  const plan = `library  ${library.root}\nscope    ${values.subpath ?? '(entire library)'}\nmeasure  dynamic range of new or changed tracks (decodes audio; read-only)`;
  if (!values.confirm) {
    console.log(`${plan}\n\nNothing has been read. Re-run with --confirm to proceed.`);
    return EXIT.usage;
  }
  console.log(plan);
  if (!(await findFfmpeg())) {
    console.error('\nffmpeg not found on PATH: measuring dynamic range needs it.');
    return EXIT.config;
  }
  const database = openCatalogDatabase(dirs.dataDir);
  const controller = new AbortController();
  const onSigint = () => {
    console.error('\nStopping after the files in progress…');
    controller.abort();
  };
  process.once('SIGINT', onSigint);
  try {
    migrateCatalog(database);
    const started = Date.now();
    const summary = await analyzeLibrary({
      db: database.db,
      reader: createLibraryReader(library.root),
      subpath: values.subpath?.replace(/\/+$/, '') ?? null,
      signal: controller.signal,
      onProgress: (done, total) => {
        if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K  ${done}/${total} files…`);
      },
    });
    if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
    console.log(
      `\nanalyzed   ${summary.files} files, ${summary.tracks} tracks in ${Math.round((Date.now() - started) / 1000)} s`,
    );
    if (summary.ffmpegMissing) {
      console.error('ffmpeg could not be started, so measuring stopped.');
      return EXIT.failed;
    }
    if (summary.failed.length > 0) {
      console.log(`failed     ${summary.failed.length}`);
      for (const f of summary.failed.slice(0, 20)) console.log(`  ${f.relPath}: ${f.message}`);
    }
    return controller.signal.aborted
      ? EXIT.aborted
      : summary.failed.length > 0
        ? EXIT.failed
        : EXIT.ok;
  } finally {
    process.off('SIGINT', onSigint);
    database.close();
  }
}

function progressPrinter(): (p: { seen: number }) => void {
  if (!process.stderr.isTTY) return () => {};
  return ({ seen }) => {
    if (seen % 100 === 0) process.stderr.write(`\r  ${seen} files…`);
  };
}

function scansProgressPrinter(): (p: { albums: number; total: number }) => void {
  if (!process.stderr.isTTY) return () => {};
  return ({ albums, total }) =>
    process.stderr.write(`\r\x1b[K  artwork scans: ${albums}/${total} albums…`);
}

function printSummary(s: ScanSummary): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
  const c = s.counters;
  const lines = [
    '',
    `status     ${s.status}${s.scanId === null ? '' : ` (scan #${s.scanId})`}`,
    `seen       ${c.seen} audio files, ${formatBytes(s.totalBytes)}`,
    `added      ${c.added}`,
    `updated    ${c.updated}`,
    `unchanged  ${c.unchanged}`,
    `restored   ${c.restored}`,
    `missing    ${s.swept ? c.missing : '(not checked)'}`,
    `errors     ${c.errors}`,
    `rip logs   ${s.images.ripLogs}`,
    `scans      ${s.images.rendered + s.images.unchanged} artwork images (${s.images.rendered} new or changed${s.images.failed > 0 ? `, ${s.images.failed} skipped` : ''})`,
  ];
  if (s.reason) lines.push('', s.reason);
  if (s.problems.length > 0) {
    lines.push('', 'Problems:');
    for (const p of s.problems.slice(0, 20)) lines.push(`  ${p.relPath}: ${p.message}`);
    if (s.problems.length > 20) lines.push(`  … and ${s.problems.length - 20} more`);
  }
  console.log(lines.join('\n'));
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
