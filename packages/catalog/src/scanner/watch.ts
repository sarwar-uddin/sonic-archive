/**
 * Notices changes in the library so the catalog can follow them (opt-in:
 * `pnpm start:watch`). Read-only: it only lists folders and asks the OS to
 * report changes; the scan that follows reads through the library reader.
 *
 * One non-recursive watch per folder, added by walking the tree the way the
 * scanner does: symlinks are never followed (Node's recursive mode would
 * follow them, possibly outside the root) and hidden folders are skipped.
 * New folders are picked up as they appear.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface LibraryWatcher {
  /** Number of folders being watched. */
  readonly size: () => number;
  close(): void;
}

export function watchLibrary(
  root: string,
  onChange: (relDir: string) => void,
  onError: (error: Error) => void = () => {},
): LibraryWatcher {
  const watchers = new Map<string, fs.FSWatcher>();

  const unwatch = (relDir: string) => {
    for (const [dir, watcher] of watchers) {
      if (dir === relDir || dir.startsWith(`${relDir}${path.sep}`) || relDir === '') {
        watcher.close();
        watchers.delete(dir);
      }
    }
  };

  const add = (relDir: string) => {
    if (watchers.has(relDir)) return;
    const absolute = path.join(root, relDir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
      const watcher = fs.watch(absolute, { persistent: true }, (eventType, name) => {
        if (name === null || name.startsWith('.')) return;
        if (eventType === 'rename') {
          const child = path.join(relDir, name);
          const st = fs.lstatSync(path.join(root, child), { throwIfNoEntry: false });
          if (st?.isDirectory()) add(child);
          else if (!st) unwatch(child);
        }
        onChange(relDir);
      });
      watcher.on('error', () => unwatch(relDir));
      watchers.set(relDir, watcher);
    } catch (error) {
      onError(error as Error);
      return;
    }
    for (const entry of entries) {
      // Dirent types do not follow symlinks: a link to a folder is not a folder here.
      if (entry.isDirectory() && !entry.name.startsWith('.')) add(path.join(relDir, entry.name));
    }
  };

  add('');
  return {
    size: () => watchers.size,
    close: () => unwatch(''),
  };
}

/**
 * Runs `task` once changes have gone quiet for `quietMs`, never two at a
 * time: changes that arrive during a run cause exactly one more run.
 * Copying an album folder fires hundreds of events; this turns them into
 * one scan.
 */
export function createDebouncedRunner(task: () => Promise<void>, quietMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  const run = async () => {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = task().catch(() => {});
    await running;
    running = null;
    if (again) {
      again = false;
      schedule();
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, quietMs);
  };
  return {
    schedule,
    /** Resolves once nothing is pending or running (for tests and shutdown). */
    async idle() {
      while (timer || running) {
        await (running ?? new Promise((r) => setTimeout(r, quietMs)));
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
