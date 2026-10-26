/**
 * Keeps the catalog in step with the library while the app runs (opt-in:
 * `pnpm start:watch`, which you choose to run; docs/safety.md #5). Changes
 * reported by the watcher are batched and followed by the same incremental
 * scan as `pnpm scan --confirm`, with all its safeguards: unchanged files are
 * not read, and an unreachable library never marks files missing.
 *
 * It writes through its own database connection; request handlers keep
 * their read-only one.
 */
import {
  type CatalogDb,
  createDebouncedRunner,
  type LibraryReader,
  type RenderedImage,
  runScan,
  type ScanSummary,
  watchLibrary,
} from '@sonic-archive/catalog';
import { analyzeLibrary } from './analyze.ts';

export interface LiveLibraryDeps {
  readonly db: CatalogDb;
  readonly reader: LibraryReader;
  readonly cacheDir: string;
  readonly renderScan?: (source: Uint8Array) => Promise<RenderedImage>;
  readonly log?: (line: string) => void;
  /** How long changes must be quiet before a scan starts. */
  readonly quietMs?: number;
  /** Measure dynamic range of new tracks after each scan (needs ffmpeg). */
  readonly analyze?: boolean;
}

export function startLiveLibrary(deps: LiveLibraryDeps) {
  const log = deps.log ?? console.log;
  const scan = async () => {
    const summary = await runScan(
      {
        db: deps.db,
        reader: deps.reader,
        cacheDir: deps.cacheDir,
        ...(deps.renderScan && { renderScan: deps.renderScan }),
      },
      { mode: 'incremental' },
    );
    log(describe(summary));
    if (deps.analyze && summary.status === 'completed') {
      const analysis = await analyzeLibrary({ db: deps.db, reader: deps.reader, concurrency: 2 });
      if (analysis.files > 0 || analysis.failed.length > 0) {
        log(`dynamic range: ${analysis.tracks} tracks measured, ${analysis.failed.length} failed`);
      }
    }
  };
  const runner = createDebouncedRunner(scan, deps.quietMs ?? 4000);
  const watcher = watchLibrary(
    deps.reader.root,
    () => runner.schedule(),
    (error) => log(`watch: ${error.message}`),
  );
  log(`watching ${watcher.size()} folders in ${deps.reader.root}`);
  // Catch up with anything that changed while the app was not running.
  runner.schedule();
  return {
    idle: () => runner.idle(),
    close() {
      runner.cancel();
      watcher.close();
    },
  };
}

function describe(s: ScanSummary): string {
  const c = s.counters;
  const changed = [
    c.added && `${c.added} added`,
    c.updated && `${c.updated} updated`,
    c.restored && `${c.restored} restored`,
    s.swept && c.missing && `${c.missing} missing`,
    c.errors && `${c.errors} unreadable`,
  ].filter(Boolean);
  return `library scan #${s.scanId}: ${s.status}${changed.length ? `, ${changed.join(', ')}` : ', no changes'}${s.reason ? ` (${s.reason})` : ''}`;
}
