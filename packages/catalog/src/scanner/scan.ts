import fs from 'node:fs';
import path from 'node:path';
import { MAX_ARTWORK_BYTES, storeArtwork } from '../cache/artwork-cache.ts';
import {
  type Credit,
  getAlbumOfFile,
  type NewArtwork,
  pruneEmptyAlbums,
  removeOtherSegments,
  setAlbumArtwork,
  upsertAlbum,
  upsertArtist,
  upsertArtwork,
  upsertGenre,
  upsertTrack,
} from '../db/catalog-repository.ts';
import type { CatalogDb } from '../db/database.ts';
import {
  abortStaleScans,
  countKnownFiles,
  ensureLibraryRoot,
  type FileRow,
  findLibraryRoot,
  findUnseenFiles,
  finishScan,
  getFileByPath,
  markFileSeen,
  markFilesMissing,
  type ScanCounters,
  startScan,
  upsertFile,
} from '../db/library-repository.ts';
import { rebuildSearchIndex } from '../db/search-index.ts';
import type { AudioFileEntry, LibraryReader, WalkEvent } from '../fs/library-reader.ts';
import { PathSafetyError, resolveInsideRoot } from '../fs/resolve-inside-root.ts';
import {
  type CueMatch,
  cueSegments,
  matchCueSheet,
  type NamedCueSheet,
  withCueSheet,
} from '../metadata/cue.ts';
import { albumFolder, type CatalogRecord, splitByCue, toCatalogRecord } from '../metadata/map.ts';

export interface ScanDeps {
  readonly db: CatalogDb;
  readonly reader: LibraryReader;
  /** App cache dir; extracted artwork goes in `<cacheDir>/artwork`. */
  readonly cacheDir: string;
}

export interface MassMissingThreshold {
  /** Abort if more than this fraction of known files would become missing… */
  readonly ratio: number;
  /** …and at least this many files would. Small libraries stay usable. */
  readonly minCount: number;
}

export const DEFAULT_MASS_MISSING: MassMissingThreshold = { ratio: 0.2, minCount: 10 };

export interface ScanOptions {
  /** `incremental` skips files whose size and mtime are unchanged. */
  readonly mode: 'incremental' | 'full';
  /** Limit the scan to this root-relative folder. Never marks files missing. */
  readonly subpath?: string;
  /** Walk and compare with the catalog; read no file contents and change no catalog rows. */
  readonly dryRun?: boolean;
  readonly allowMassMissing?: boolean;
  readonly massMissing?: MassMissingThreshold;
  /** Parallel tag parsers; database writes stay sequential. */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: { seen: number; currentPath: string }) => void;
  readonly now?: () => Date;
}

export interface ScanProblem {
  readonly relPath: string;
  readonly message: string;
}

export interface ScanSummary {
  readonly scanId: number | null;
  readonly status: 'completed' | 'aborted' | 'failed' | 'dry-run';
  readonly scopeSubpath: string | null;
  readonly counters: ScanCounters;
  /** Whether unseen files were checked and marked missing. */
  readonly swept: boolean;
  readonly reason: string | null;
  /** First problems encountered (capped), for display. */
  readonly problems: readonly ScanProblem[];
  readonly totalBytes: number;
}

const MAX_REPORTED_PROBLEMS = 100;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Scans the library into the catalog.
 *
 * Safety properties (docs/safety.md):
 * - Library files are only read, via `reader`.
 * - File rows are never deleted. Unseen files are marked missing, and only
 *   after a complete, full-scope scan that passed the mass-missing check.
 * - Rerunning the same scan changes nothing.
 */
export async function runScan(deps: ScanDeps, options: ScanOptions): Promise<ScanSummary> {
  const now = options.now ?? (() => new Date());
  const scopeSubpath = normalizeSubpath(deps.reader.root, options.subpath);
  return options.dryRun
    ? dryRun(deps, scopeSubpath, options)
    : realScan(deps, scopeSubpath, options, now);
}

async function realScan(
  deps: ScanDeps,
  scopeSubpath: string | null,
  options: ScanOptions,
  now: () => Date,
): Promise<ScanSummary> {
  const { db, reader } = deps;
  const startedAt = now();
  const { rootId, scanId } = db.transaction((tx) => {
    const root = ensureLibraryRoot(tx, reader.root);
    abortStaleScans(tx, root.id, startedAt);
    const scan = startScan(tx, { rootId: root.id, mode: options.mode, scopeSubpath, startedAt });
    return { rootId: root.id, scanId: scan.id };
  });

  const counters: Mutable<ScanCounters> = zeroCounters();
  const problems: ScanProblem[] = [];
  let totalBytes = 0;
  let walkComplete = true;

  const report = (relPath: string, message: string) => {
    if (problems.length < MAX_REPORTED_PROBLEMS) problems.push({ relPath, message });
  };

  const finish = (
    status: 'completed' | 'aborted' | 'failed',
    swept: boolean,
    reason: string | null,
  ): ScanSummary => {
    // Even a cancelled or failed scan may have written some tracks first.
    // A full scan rewrites the tracks of unchanged files too, so counters
    // alone cannot say whether anything changed.
    if (context.wroteTracks) {
      pruneEmptyAlbums(db);
      rebuildSearchIndex(db);
    }
    finishScan(db, scanId, {
      status,
      finishedAt: now(),
      counters,
      ...(reason !== null && { errorMessage: reason }),
    });
    return { scanId, status, scopeSubpath, counters, swept, reason, problems, totalBytes };
  };

  const context: ScanContext = {
    wroteTracks: false,
    rootId,
    scanId,
    mode: options.mode,
    folderArt: new Map(),
    cueSheets: new Map(),
    artChecked: new Set(),
  };
  try {
    await forEachConcurrent(
      reader.walk(scopeSubpath ?? ''),
      options.concurrency ?? 4,
      options.signal,
      async (event: WalkEvent) => {
        if (event.kind === 'problem') {
          if (event.reason === 'unreadable-directory') walkComplete = false;
          counters.errors++;
          report(event.relPath, event.message);
          return;
        }
        counters.seen++;
        totalBytes += event.size;
        options.onProgress?.({ seen: counters.seen, currentPath: event.relPath });
        await processFile(deps, context, event, counters, report);
      },
    );
  } catch (error) {
    // The starting directory could not be read, or something unexpected
    // failed. Either way, nothing is swept.
    return finish('failed', false, (error as Error).message);
  }

  if (options.signal?.aborted) return finish('aborted', false, 'Cancelled.');
  if (scopeSubpath !== null) return finish('completed', false, null);
  if (!walkComplete) {
    return finish(
      'completed',
      false,
      'Some folders could not be read, so no files were marked missing.',
    );
  }

  // Sweep: a complete, full-scope scan may now flag unseen files as missing.
  const unseen = findUnseenFiles(db, rootId, scanId);
  const known = countKnownFiles(db, rootId, scanId);
  const threshold = options.massMissing ?? DEFAULT_MASS_MISSING;
  if (
    !options.allowMassMissing &&
    unseen.length >= threshold.minCount &&
    unseen.length > known * threshold.ratio
  ) {
    return finish(
      'aborted',
      false,
      `${unseen.length} of ${known} known files were not found. Refusing to mark them missing; ` +
        'check that the library is complete, then rerun with --allow-mass-missing if intended.',
    );
  }
  markFilesMissing(db, unseen, now());
  counters.missing = unseen.length;
  return finish('completed', true, null);
}

interface ScanContext {
  /** Set once any file's tracks were (re)written during this scan. */
  wroteTracks: boolean;
  readonly rootId: number;
  readonly scanId: number;
  readonly mode: ScanOptions['mode'];
  /** Folder artwork per directory, looked up once per scan. */
  readonly folderArt: Map<string, Promise<NewArtwork | null>>;
  /** CUE sheets per directory, read once per scan. */
  readonly cueSheets: Map<string, Promise<NamedCueSheet[]>>;
  /** Albums already checked for missing artwork during this scan. */
  readonly artChecked: Set<number>;
}

async function processFile(
  deps: ScanDeps,
  ctx: ScanContext,
  entry: AudioFileEntry,
  counters: Mutable<ScanCounters>,
  report: (relPath: string, message: string) => void,
): Promise<void> {
  const { db, reader, cacheDir } = deps;
  const existing = getFileByPath(db, ctx.rootId, entry.relPath);
  const statUnchanged =
    existing !== undefined && existing.size === entry.size && existing.mtimeMs === entry.mtimeMs;

  // Incremental fast path: same size and mtime means same file; don't read it.
  if (statUnchanged && ctx.mode === 'incremental' && existing.status !== 'missing') {
    markFileSeen(db, existing.id, ctx.scanId);
    if (existing.status === 'present')
      await fillMissingArtwork(deps, ctx, existing.id, entry.relPath);
    if (existing.status === 'error') {
      counters.errors++;
      report(entry.relPath, existing.errorMessage ?? 'Previously unreadable.');
    } else {
      counters.unchanged++;
    }
    return;
  }

  const fileBase = {
    rootId: ctx.rootId,
    relPath: entry.relPath,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    scanId: ctx.scanId,
  };

  let records: CatalogRecord[];
  let audioMd5: string | null;
  try {
    const read = await reader.readAudio(entry.relPath);
    let metadata = read.metadata;
    // A CUE sheet fills album details the tags lack (single-file CD images
    // are often untagged), and splits an image into its tracks.
    const cue = await findCueSheet(deps, ctx, entry.relPath);
    if (cue) metadata = withCueSheet(metadata, cue.sheet);
    const record = toCatalogRecord(metadata, entry.relPath);
    const segments = cue?.namesFile ? cueSegments(cue.sheet, record.track.durationMs) : null;
    records = segments ? splitByCue(record, segments) : [record];
    audioMd5 = read.audioMd5;
  } catch (error) {
    // One unreadable file is recorded and skipped; it never stops the scan.
    const message = (error as Error).message;
    upsertFile(db, { ...fileBase, audioMd5: null, status: 'error', errorMessage: message });
    counters.errors++;
    report(entry.relPath, message);
    return;
  }

  // Folder art (cover.jpg, folder.jpg, …) wins over embedded art: it is usually
  // the curated scan, and it gives every track of the album the same cover.
  // Written to the cache dir before the transaction; harmless if it rolls back.
  const picture = records[0]?.picture ?? null;
  const artwork =
    (await findFolderArt(deps, ctx, entry.relPath)) ??
    (picture ? storeArtwork(cacheDir, picture) : null);

  db.transaction((tx) => {
    const file = upsertFile(tx, { ...fileBase, audioMd5, status: 'present', errorMessage: null });
    const artworkId = artwork ? upsertArtwork(tx, artwork) : null;
    for (const record of records) {
      const albumArtistId = record.album.albumArtist
        ? upsertArtist(tx, record.album.albumArtist)
        : null;
      const { albumArtist: _, ...album } = record.album;
      const albumId = upsertAlbum(tx, { ...album, albumArtistId, artworkId });
      const credits: Credit[] = [
        ...record.artists.map((name) => ({
          artistId: upsertArtist(tx, name),
          role: 'artist' as const,
        })),
        ...record.composers.map((name) => ({
          artistId: upsertArtist(tx, name),
          role: 'composer' as const,
        })),
      ];
      const genreIds = record.genres.map((name) => upsertGenre(tx, name));
      upsertTrack(tx, { ...record.track, fileId: file.id, albumId, credits, genreIds });
    }
    removeOtherSegments(
      tx,
      file.id,
      records.map((r) => r.track.segment),
    );
  });
  ctx.wroteTracks = true;

  countChange(existing, statUnchanged, counters);
}

/**
 * An unchanged file is not re-read, but its album may still lack a cover
 * that has since been added to the folder (or that a newer version of the
 * cover rules can now recognize). Checked once per album per scan.
 */
async function fillMissingArtwork(
  deps: ScanDeps,
  ctx: ScanContext,
  fileId: number,
  relPath: string,
): Promise<void> {
  const album = getAlbumOfFile(deps.db, fileId);
  if (!album || album.artworkId !== null || ctx.artChecked.has(album.albumId)) return;
  ctx.artChecked.add(album.albumId);
  const art = await findFolderArt(deps, ctx, relPath);
  if (art) {
    deps.db.transaction((tx) => setAlbumArtwork(tx, album.albumId, upsertArtwork(tx, art)));
  }
}

/** The CUE sheet for an audio file, from the sheets in its folder. */
async function findCueSheet(
  deps: ScanDeps,
  ctx: ScanContext,
  relPath: string,
): Promise<CueMatch | null> {
  const dir = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
  let pending = ctx.cueSheets.get(dir);
  if (!pending) {
    // An unreadable sheet means no sheet, not a failed file.
    pending = deps.reader.readCueSheets(dir).catch(() => []);
    ctx.cueSheets.set(dir, pending);
  }
  return matchCueSheet(await pending, path.basename(relPath));
}

function findFolderArt(
  deps: ScanDeps,
  ctx: ScanContext,
  relPath: string,
): Promise<NewArtwork | null> {
  const ownDir = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
  // The file's own folder first, then the album folder above CD1/Disc 2.
  const dirs = [...new Set([ownDir, albumFolder(relPath)])];
  const lookup = (dir: string) => {
    let pending = ctx.folderArt.get(dir);
    if (!pending) {
      pending = (async () => {
        const image = await deps.reader.findFolderArtwork(dir);
        if (image === null) return null;
        const data = await deps.reader.readImage(image, MAX_ARTWORK_BYTES);
        return data === null ? null : storeArtwork(deps.cacheDir, { data }, 'folder');
      })().catch(() => null); // unreadable art means no cover, not a failed file
      ctx.folderArt.set(dir, pending);
    }
    return pending;
  };
  return dirs.reduce<Promise<NewArtwork | null>>(
    async (found, dir) => (await found) ?? lookup(dir),
    Promise.resolve(null),
  );
}

function countChange(
  existing: FileRow | undefined,
  statUnchanged: boolean,
  counters: Mutable<ScanCounters>,
): void {
  if (existing === undefined) counters.added++;
  else if (existing.status === 'missing') counters.restored++;
  else if (statUnchanged)
    counters.unchanged++; // full mode re-read an unchanged file
  else counters.updated++;
}

async function dryRun(
  deps: ScanDeps,
  scopeSubpath: string | null,
  options: ScanOptions,
): Promise<ScanSummary> {
  const { db, reader } = deps;
  const root = findLibraryRoot(db, reader.root);
  const counters: Mutable<ScanCounters> = zeroCounters();
  const problems: ScanProblem[] = [];
  let totalBytes = 0;

  for await (const event of reader.walk(scopeSubpath ?? '')) {
    if (options.signal?.aborted) break;
    if (event.kind === 'problem') {
      counters.errors++;
      if (problems.length < MAX_REPORTED_PROBLEMS) problems.push(event);
      continue;
    }
    counters.seen++;
    totalBytes += event.size;
    options.onProgress?.({ seen: counters.seen, currentPath: event.relPath });
    const existing = root ? getFileByPath(db, root.id, event.relPath) : undefined;
    if (!existing) counters.added++;
    else if (existing.status === 'missing') counters.restored++;
    else if (existing.size === event.size && existing.mtimeMs === event.mtimeMs)
      counters.unchanged++;
    else counters.updated++;
  }

  return {
    scanId: null,
    status: 'dry-run',
    scopeSubpath,
    counters,
    swept: false,
    reason: null,
    problems,
    totalBytes,
  };
}

/**
 * Validates a user-supplied scope folder. Returns null for the whole root.
 */
function normalizeSubpath(root: string, subpath: string | undefined): string | null {
  if (subpath === undefined) return null;
  const absolute = resolveInsideRoot(root, subpath);
  if (!fs.statSync(absolute).isDirectory()) {
    throw new PathSafetyError('NOT_A_DIRECTORY', `Scan scope "${subpath}" is not a directory.`);
  }
  const relative = path.relative(root, absolute);
  return relative === '' ? null : relative;
}

function zeroCounters(): Mutable<ScanCounters> {
  return { seen: 0, added: 0, updated: 0, unchanged: 0, missing: 0, restored: 0, errors: 0 };
}

/**
 * Runs `worker` over an async iterable with bounded concurrency. Stops
 * pulling new items once `signal` aborts, and rethrows the first error.
 */
async function forEachConcurrent<T>(
  items: AsyncIterable<T>,
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const iterator = items[Symbol.asyncIterator]();
  let failure: unknown;
  const lane = async () => {
    while (failure === undefined && !signal?.aborted) {
      const next = await iterator.next();
      if (next.done) return;
      try {
        await worker(next.value);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  if (failure !== undefined) throw failure;
}
