import { and, count, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { CatalogExecutor } from './database.ts';
import { files, libraryRoots, type SCAN_MODES, type SCAN_STATUSES, scans } from './schema.ts';
import { excluded } from './sql-helpers.ts';

export type LibraryRoot = typeof libraryRoots.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type FileRow = typeof files.$inferSelect;

/** Returns the row for this root path, creating it on first use. */
export function ensureLibraryRoot(db: CatalogExecutor, rootPath: string): LibraryRoot {
  db.insert(libraryRoots).values({ path: rootPath }).onConflictDoNothing().run();
  const row = db.select().from(libraryRoots).where(eq(libraryRoots.path, rootPath)).get();
  if (!row) throw new Error(`Library root row missing after insert: ${rootPath}`);
  return row;
}

export function findLibraryRoot(db: CatalogExecutor, rootPath: string): LibraryRoot | undefined {
  return db.select().from(libraryRoots).where(eq(libraryRoots.path, rootPath)).get();
}

export interface StartScanInput {
  readonly rootId: number;
  readonly mode: (typeof SCAN_MODES)[number];
  readonly scopeSubpath: string | null;
  readonly startedAt: Date;
}

export function startScan(db: CatalogExecutor, input: StartScanInput): Scan {
  return db
    .insert(scans)
    .values({ ...input, status: 'running' })
    .returning()
    .get();
}

export interface ScanCounters {
  readonly seen: number;
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly missing: number;
  readonly restored: number;
  readonly errors: number;
}

export interface FinishScanInput {
  readonly status: Exclude<(typeof SCAN_STATUSES)[number], 'running'>;
  readonly finishedAt: Date;
  readonly counters: ScanCounters;
  readonly errorMessage?: string;
}

export function finishScan(db: CatalogExecutor, scanId: number, input: FinishScanInput): Scan {
  const row = db
    .update(scans)
    .set({
      status: input.status,
      finishedAt: input.finishedAt,
      ...input.counters,
      errorMessage: input.errorMessage ?? null,
    })
    .where(and(eq(scans.id, scanId), eq(scans.status, 'running')))
    .returning()
    .get();
  if (!row) throw new Error(`Scan ${scanId} does not exist or has already finished.`);
  return row;
}

export function getScan(db: CatalogExecutor, scanId: number): Scan | undefined {
  return db.select().from(scans).where(eq(scans.id, scanId)).get();
}

export function listScans(db: CatalogExecutor, limit = 50): Scan[] {
  return db.select().from(scans).orderBy(desc(scans.id)).limit(limit).all();
}

export interface FileUpsertInput {
  readonly rootId: number;
  readonly relPath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly audioMd5: string | null;
  readonly status: 'present' | 'error';
  readonly errorMessage: string | null;
  readonly scanId: number;
}

/**
 * Inserts or refreshes a file keyed by (root, relative path). Re-seeing a
 * file never creates a second row, and clears any earlier `missing` state.
 */
export function upsertFile(db: CatalogExecutor, input: FileUpsertInput): FileRow {
  if (!Number.isInteger(input.mtimeMs)) {
    throw new Error(`mtimeMs must be whole milliseconds (got ${input.mtimeMs}).`);
  }
  const { scanId, ...values } = input;
  return db
    .insert(files)
    .values({ ...values, firstSeenScanId: scanId, lastSeenScanId: scanId, missingSince: null })
    .onConflictDoUpdate({
      target: [files.rootId, files.relPath],
      set: {
        size: excluded(files.size),
        mtimeMs: excluded(files.mtimeMs),
        audioMd5: excluded(files.audioMd5),
        status: excluded(files.status),
        errorMessage: excluded(files.errorMessage),
        lastSeenScanId: excluded(files.lastSeenScanId),
        missingSince: null,
      },
    })
    .returning()
    .get();
}

/** Records that an unchanged file was seen by a scan, without reparsing it. */
export function markFileSeen(db: CatalogExecutor, fileId: number, scanId: number): void {
  db.update(files).set({ lastSeenScanId: scanId }).where(eq(files.id, fileId)).run();
}

export function getFileByPath(
  db: CatalogExecutor,
  rootId: number,
  relPath: string,
): FileRow | undefined {
  return db
    .select()
    .from(files)
    .where(and(eq(files.rootId, rootId), eq(files.relPath, relPath)))
    .get();
}

/**
 * Closes scans left `running` by a crash or kill, so the history never shows
 * a phantom scan in progress. Their files are left exactly as they were.
 */
export function abortStaleScans(db: CatalogExecutor, rootId: number, at: Date): number {
  return db
    .update(scans)
    .set({ status: 'aborted', finishedAt: at, errorMessage: 'Interrupted before completion.' })
    .where(and(eq(scans.rootId, rootId), eq(scans.status, 'running')))
    .run().changes;
}

/** Non-missing files under the root that the given scan did not see. */
export function findUnseenFiles(db: CatalogExecutor, rootId: number, scanId: number): number[] {
  return db
    .select({ id: files.id })
    .from(files)
    .where(
      and(eq(files.rootId, rootId), ne(files.status, 'missing'), lt(files.lastSeenScanId, scanId)),
    )
    .all()
    .map((row) => row.id);
}

/** Files that were known (and not already missing) before the given scan began. */
export function countKnownFiles(db: CatalogExecutor, rootId: number, scanId: number): number {
  const row = db
    .select({ n: count() })
    .from(files)
    .where(
      and(eq(files.rootId, rootId), ne(files.status, 'missing'), lt(files.firstSeenScanId, scanId)),
    )
    .get();
  return row?.n ?? 0;
}

/** Flags files as missing. Rows are kept: missing is a state, not a deletion. */
export function markFilesMissing(db: CatalogExecutor, fileIds: readonly number[], at: Date): void {
  // Chunked to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < fileIds.length; i += 500) {
    db.update(files)
      .set({ status: 'missing', missingSince: at })
      .where(inArray(files.id, fileIds.slice(i, i + 500)))
      .run();
  }
}
