import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFixtureLibrary, type LibraryCopy } from '../testing/fixtures.ts';
import { createDebouncedRunner, type LibraryWatcher, watchLibrary } from './watch.ts';

let lib: LibraryCopy;
let watcher: LibraryWatcher | null = null;

beforeEach(() => {
  lib = copyFixtureLibrary();
});

afterEach(() => {
  watcher?.close();
  watcher = null;
  lib.cleanup();
});

const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('watchLibrary', () => {
  it('reports changes in any folder, including folders created later', async () => {
    const changes: string[] = [];
    watcher = watchLibrary(lib.root, (dir) => changes.push(dir));
    const folders = watcher.size();
    expect(folders).toBeGreaterThan(10);

    fs.writeFileSync(path.join(lib.root, 'Drift/Double Album (1999)/CD1/new.flac'), 'x');
    await until(() => changes.includes(path.join('Drift', 'Double Album (1999)', 'CD1')));

    fs.mkdirSync(path.join(lib.root, 'New Artist'));
    await until(() => watcher?.size() === folders + 1);
    fs.writeFileSync(path.join(lib.root, 'New Artist/a.flac'), 'x');
    await until(() => changes.includes('New Artist'));
  });

  it('ignores hidden files and does not follow symlinks out of the root', async () => {
    fs.mkdirSync(path.join(lib.outside, 'elsewhere'));
    fs.symlinkSync(path.join(lib.outside, 'elsewhere'), path.join(lib.root, 'link'));
    const changes: string[] = [];
    watcher = watchLibrary(lib.root, (dir) => changes.push(dir));
    fs.writeFileSync(path.join(lib.outside, 'elsewhere', 'a.flac'), 'x');
    fs.writeFileSync(path.join(lib.root, '.DS_Store'), 'x');
    await new Promise((r) => setTimeout(r, 200));
    expect(changes).toEqual([]);
  });

  it('stops watching removed folders', async () => {
    watcher = watchLibrary(lib.root, () => {});
    const before = watcher.size();
    fs.rmSync(path.join(lib.root, 'Drift'), { recursive: true });
    await until(() => (watcher?.size() ?? 0) <= before - 4);
  });
});

describe('createDebouncedRunner', () => {
  it('turns a burst of changes into one run, and changes during a run into one more', async () => {
    let release: () => void = () => {};
    const task = vi.fn(() => new Promise<void>((r) => (release = r)));
    const runner = createDebouncedRunner(task, 20);
    runner.schedule();
    runner.schedule();
    runner.schedule();
    await until(() => task.mock.calls.length === 1);
    runner.schedule(); // arrives mid-run
    runner.schedule();
    await new Promise((r) => setTimeout(r, 60));
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await until(() => task.mock.calls.length === 2);
    release();
    await runner.idle();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
