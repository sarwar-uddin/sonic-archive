/**
 * Lists folders for the in-app music folder picker. Names of subfolders
 * only: no files, no file names, no contents, no recursion. Browsers cannot
 * hand a local server a folder's path, so the server lists them itself; like
 * every endpoint, this answers only on 127.0.0.1 behind the Host allowlist.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FolderListing } from '@sonic-archive/contracts';

export class FolderError extends Error {}

export function listFolders(input: string | undefined, homeDir = os.homedir()): FolderListing {
  const requested = input ?? homeDir;
  if (!path.isAbsolute(requested) || requested.includes('\0')) {
    throw new FolderError('Give an absolute folder path.');
  }
  let absolute: string;
  let entries: fs.Dirent[];
  try {
    absolute = fs.realpathSync.native(path.resolve(requested));
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new FolderError(
      code === 'ENOENT' || code === 'ENOTDIR'
        ? 'That folder does not exist.'
        : code === 'EACCES' || code === 'EPERM'
          ? 'That folder cannot be opened (permission denied).'
          : 'That folder cannot be opened.',
    );
  }
  const folders = entries
    .filter((e) => !e.name.startsWith('.') && isFolder(path.join(absolute, e.name), e))
    .map((e) => ({ name: e.name, path: path.join(absolute, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const parent = path.dirname(absolute);
  return {
    path: absolute,
    parent: parent === absolute ? null : parent,
    folders,
    places: places(homeDir),
  };
}

/** A folder, or a link to one (a music folder is often a link to a data disk). */
function isFolder(absolute: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function places(homeDir: string): FolderListing['places'] {
  const user = path.basename(homeDir);
  const candidates = [
    { name: 'Home', path: homeDir },
    { name: 'Music', path: path.join(homeDir, 'Music') },
    { name: 'Drives', path: `/run/media/${user}` },
    { name: 'Drives', path: `/media/${user}` },
    { name: 'Volumes', path: '/Volumes' },
    { name: 'Mounts', path: '/mnt' },
  ];
  return candidates.filter((p) => {
    try {
      return fs.statSync(p.path).isDirectory();
    } catch {
      return false;
    }
  });
}
