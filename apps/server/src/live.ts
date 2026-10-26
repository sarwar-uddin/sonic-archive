/**
 * Keeps the catalog in step with the music folder while the app runs: a
 * scan when it starts, then (if watching is on) after each burst of changes,
 * and on request. Every scan is the same incremental scan as
 * `pnpm scan --confirm`, with all its safeguards: unchanged files are not
 * read, and an unreachable folder never marks files missing. New tracks'
 * dynamic range is measured afterwards.
 *
 * It writes through its own database connection; request handlers keep
 * their read-only one.
 */
import {
  type CatalogDb,
  createDebouncedRunner,
  type LibraryReader,
  type LibraryWatcher,
  type RenderedImage,
  runScan,
  type ScanSummary,
  watchLibrary,
} from '@sonic-archive/catalog';
import { analyzeLibrary } from './analyze.ts';

export type LiveState =
  | { readonly state: 'idle' }
  | { readonly state: 'scanning'; readonly done: number }
  | { readonly state: 'analyzing'; readonly done: number; readonly total: number };

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
  /** Follow changes in the folder (otherwise: scan on start and on request). */
  readonly watch?: boolean;
  readonly onState?: (state: LiveState) => void;
  /** A scan that failed or stopped, or null once one completes. */
  readonly onError?: (message: string | null) => void;
}

export interface LiveLibrary {
  /** Scans now (a full re-read when `full`), after any scan in progress. */
  rescan(full?: boolean): void;
  setWatching(on: boolean): void;
  /** Resolves once nothing is pending or running. */
  idle(): Promise<void>;
  close(): void;
}

export function startLiveLibrary(deps: LiveLibraryDeps): LiveLibrary {
  const log = deps.log ?? console.log;
  const setState = (state: LiveState) => deps.onState?.(state);
  let full = false;
  let closed = false;

  const scan = async () => {
    const mode = full ? 'full' : 'incremental';
    full = false;
    try {
      setState({ state: 'scanning', done: 0 });
      const summary = await runScan(
        {
          db: deps.db,
          reader: deps.reader,
          cacheDir: deps.cacheDir,
          ...(deps.renderScan && { renderScan: deps.renderScan }),
        },
        { mode, onProgress: ({ seen }) => setState({ state: 'scanning', done: seen }) },
      );
      log(describe(summary));
      deps.onError?.(summary.status === 'completed' ? null : summary.reason);
      if (deps.analyze && summary.status === 'completed' && !closed) {
        const analysis = await analyzeLibrary({
          db: deps.db,
          reader: deps.reader,
          concurrency: 2,
          onProgress: (done, total) => setState({ state: 'analyzing', done, total }),
        });
        if (analysis.files > 0 || analysis.failed.length > 0) {
          log(
            `dynamic range: ${analysis.tracks} tracks measured, ${analysis.failed.length} failed`,
          );
        }
      }
    } catch (error) {
      log(`library scan failed: ${(error as Error).message}`);
      deps.onError?.((error as Error).message);
    } finally {
      setState({ state: 'idle' });
    }
  };

  const runner = createDebouncedRunner(scan, deps.quietMs ?? 4000);
  let watcher: LibraryWatcher | null = null;
  const setWatching = (on: boolean) => {
    if (on && !watcher && !closed) {
      watcher = watchLibrary(
        deps.reader.root,
        () => runner.schedule(),
        (error) => log(`watch: ${error.message}`),
      );
      log(`watching ${watcher.size()} folders in ${deps.reader.root}`);
    } else if (!on && watcher) {
      watcher.close();
      watcher = null;
    }
  };

  setWatching(deps.watch ?? true);
  // Catch up with anything that changed while the app was not running.
  runner.now();

  return {
    rescan(fullScan = false) {
      if (fullScan) full = true;
      runner.now();
    },
    setWatching,
    idle: () => runner.idle(),
    close() {
      closed = true;
      runner.cancel();
      setWatching(false);
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
