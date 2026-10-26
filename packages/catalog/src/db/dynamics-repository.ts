import { sql } from 'drizzle-orm';
import type { CatalogExecutor } from './database.ts';
import { trackDynamics } from './schema.ts';

/** One file to decode, with the span of each of its tracks. */
export interface AnalysisJob {
  readonly fileId: number;
  readonly relPath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly codec: string | null;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  /** In file order; a whole-file track is one span from 0 with no end. */
  readonly tracks: readonly { trackId: number; startMs: number; endMs: number | null }[];
}

/**
 * Present files with a track never measured, or measured before the file
 * last changed. A file is decoded once for all its tracks (a CD image).
 */
export function findAnalysisJobs(
  db: CatalogExecutor,
  subpath: string | null = null,
): AnalysisJob[] {
  const rows = db.all<{
    file_id: number;
    rel_path: string;
    size: number;
    mtime_ms: number;
    codec: string | null;
    sample_rate: number | null;
    channels: number | null;
    track_id: number;
    start_ms: number | null;
    end_ms: number | null;
  }>(sql`
    SELECT f.id AS file_id, f.rel_path, f.size, f.mtime_ms, t.codec, t.sample_rate, t.channels,
           t.id AS track_id, t.start_ms, t.end_ms
    FROM files f JOIN tracks t ON t.file_id = f.id
    WHERE f.status = 'present'
      AND (${subpath} IS NULL OR f.rel_path LIKE ${`${subpath ?? ''}/%`})
      AND f.id IN (
        SELECT t2.file_id FROM tracks t2
        LEFT JOIN track_dynamics d ON d.track_id = t2.id
        WHERE d.track_id IS NULL OR d.source_size != f.size OR d.source_mtime_ms != f.mtime_ms)
    ORDER BY f.rel_path, t.segment`);
  const jobs = new Map<number, AnalysisJob & { tracks: AnalysisJob['tracks'][number][] }>();
  for (const r of rows) {
    let job = jobs.get(r.file_id);
    if (!job) {
      job = {
        fileId: r.file_id,
        relPath: r.rel_path,
        size: r.size,
        mtimeMs: r.mtime_ms,
        codec: r.codec,
        sampleRate: r.sample_rate,
        channels: r.channels,
        tracks: [],
      };
      jobs.set(r.file_id, job);
    }
    job.tracks.push({ trackId: r.track_id, startMs: r.start_ms ?? 0, endMs: r.end_ms });
  }
  return [...jobs.values()];
}

export interface DynamicsResult {
  readonly trackId: number;
  readonly drExact: number | null;
  readonly peakDb: number | null;
}

/** Stores the measurements of one file's tracks, stamped with its size and mtime. */
export function saveDynamics(
  db: CatalogExecutor,
  job: Pick<AnalysisJob, 'size' | 'mtimeMs'>,
  results: readonly DynamicsResult[],
): void {
  db.transaction((tx) => {
    for (const r of results) {
      const values = {
        drExact: r.drExact,
        peakDb: r.peakDb,
        sourceSize: job.size,
        sourceMtimeMs: job.mtimeMs,
      };
      tx.insert(trackDynamics)
        .values({ trackId: r.trackId, ...values })
        .onConflictDoUpdate({ target: trackDynamics.trackId, set: values })
        .run();
    }
  });
}
