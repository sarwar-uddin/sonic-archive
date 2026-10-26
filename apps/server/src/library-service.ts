/**
 * The music folder and what the app is doing with it: the single place the
 * folder can change (the in-app picker), and the owner of the reader, the
 * live scanning loop and the status shown in the app.
 *
 * A folder chosen in the app passes the same validation as one in the
 * config file (`validateLibraryRoot`: an existing folder, not the
 * filesystem root, not the home folder or a parent of it, not overlapping the
 * app's own data) and is saved to config.json. Switching to another folder
 * rebuilds the catalog, which is derived from the folder; no music file is
 * ever written.
 */
import {
  type AppDirs,
  type AppSettings,
  type CatalogDatabase,
  ConfigError,
  createLibraryReader,
  type Env,
  type LibraryConfig,
  type LibraryReader,
  type RenderedImage,
  resetCatalog,
  rootValidationContext,
  saveConfig,
  validateLibraryRoot,
} from '@sonic-archive/catalog';
import type { LibraryStatus } from '@sonic-archive/contracts';
import { type LiveLibrary, type LiveState, startLiveLibrary } from './live.ts';

export interface LibraryService {
  status(): LibraryStatus;
  /** Read access for playback; null before a folder is chosen. */
  reader(): LibraryReader | null;
  /** Called whenever the status changes. */
  subscribe(listener: (status: LibraryStatus) => void): () => void;
  /** Validates, saves and starts indexing a new music folder. Throws ConfigError. */
  setRoot(path: string): Promise<LibraryStatus>;
  rescan(full: boolean): LibraryStatus;
  setWatching(on: boolean): LibraryStatus;
  close(): Promise<void>;
}

export interface LibraryServiceOptions {
  readonly env: Env;
  readonly homeDir: string;
  readonly dirs: AppDirs;
  readonly initial: LibraryConfig;
  readonly settings: AppSettings;
  /** A read-write connection, used only for scanning. */
  readonly database: CatalogDatabase;
  readonly renderScan?: (source: Uint8Array) => Promise<RenderedImage>;
  readonly analyze?: boolean;
  readonly quietMs?: number;
  readonly log?: (line: string) => void;
}

export function createLibraryService(options: LibraryServiceOptions): LibraryService {
  const listeners = new Set<(status: LibraryStatus) => void>();
  let root: string | null = options.initial.status === 'configured' ? options.initial.root : null;
  const source = options.initial.status === 'configured' ? options.initial.source : null;
  let watching = options.settings.watch;
  let reader: LibraryReader | null = null;
  let live: LiveLibrary | null = null;
  let state: LiveState = { state: 'idle' };
  let error: string | null = null;

  const status = (): LibraryStatus => ({
    root,
    source: root === null ? null : (source ?? 'file'),
    watching,
    state: root === null ? 'unconfigured' : state.state,
    progress:
      state.state === 'scanning'
        ? { done: state.done, total: null }
        : state.state === 'analyzing'
          ? { done: state.done, total: state.total }
          : null,
    error,
  });
  const notify = () => {
    const current = status();
    for (const listener of listeners) listener(current);
  };

  const start = () => {
    if (root === null) return;
    reader = createLibraryReader(root);
    live = startLiveLibrary({
      db: options.database.db,
      reader,
      cacheDir: options.dirs.cacheDir,
      watch: watching,
      ...(options.renderScan && { renderScan: options.renderScan }),
      ...(options.analyze !== undefined && { analyze: options.analyze }),
      ...(options.quietMs !== undefined && { quietMs: options.quietMs }),
      ...(options.log && { log: options.log }),
      onState: (next) => {
        state = next;
        notify();
      },
      onError: (message) => {
        error = message;
        notify();
      },
    });
  };

  const stop = async () => {
    const running = live;
    live = null;
    running?.close();
    await running?.idle();
    reader = null;
  };

  start();

  return {
    status,
    reader: () => reader,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setRoot(input) {
      if (source === 'env') {
        throw new ConfigError(
          'ROOT_SET_BY_ENVIRONMENT',
          'The music folder is set by SONIC_LIBRARY_ROOT and cannot be changed in the app.',
        );
      }
      const canonical = validateLibraryRoot(
        input,
        rootValidationContext(options.env, options.homeDir, options.dirs),
      );
      if (canonical === root) return status();
      await stop();
      // The catalog describes the old folder; rebuild it for the new one.
      const known = options.database.sqlite
        .prepare('SELECT count(*) AS n FROM library_roots WHERE path != ?')
        .get(canonical) as { n: number };
      if (known.n > 0) resetCatalog(options.database.db);
      saveConfig(options.dirs.configDir, { libraryRoot: canonical });
      root = canonical;
      error = null;
      state = { state: 'idle' };
      start();
      notify();
      return status();
    },
    rescan(full) {
      if (!live) throw new ConfigError('ROOT_NOT_CONFIGURED', 'Choose a music folder first.');
      live.rescan(full);
      return status();
    },
    setWatching(on) {
      watching = on;
      saveConfig(options.dirs.configDir, { watch: on });
      live?.setWatching(on);
      notify();
      return status();
    },
    async close() {
      await stop();
    },
  };
}
