/**
 * The only module that touches files inside the music library.
 *
 * Read-only by construction: it lists directories, stats files, parses tags,
 * and reads a 42-byte header, and nothing else. A static test
 * (`src/safety/read-only.test.ts`) fails if write-capable APIs appear here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type IAudioMetadata, parseFile } from 'music-metadata';
import { assertInsideTestSandbox } from '../config/sandbox.ts';
import { FLAC_HEADER_BYTES, flacAudioMd5 } from '../metadata/flac-md5.ts';
import { resolveInsideRoot } from './resolve-inside-root.ts';

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.flac',
  '.m4a',
  '.alac',
  '.wav',
  '.aif',
  '.aiff',
  '.dsf',
  '.dff',
  '.mp3',
  '.ogg',
  '.opus',
  '.wv',
  '.ape',
]);

export interface AudioFileEntry {
  readonly kind: 'file';
  readonly relPath: string;
  readonly size: number;
  /** Whole milliseconds, matching how `files.mtime_ms` is stored. */
  readonly mtimeMs: number;
}

export interface WalkProblem {
  readonly kind: 'problem';
  readonly relPath: string;
  /**
   * `unreadable-directory` means part of the tree was not seen, so a scan
   * must not conclude that files under it are missing.
   */
  readonly reason: 'unreadable-directory' | 'unreadable-file' | 'invalid-filename';
  readonly message: string;
}

export type WalkEvent = AudioFileEntry | WalkProblem;

export interface WalkStats {
  skippedHidden: number;
  skippedSymlinks: number;
  skippedNonAudio: number;
}

export interface AudioRead {
  readonly metadata: IAudioMetadata;
  readonly audioMd5: string | null;
}

export interface LibraryReader {
  /** Canonical absolute path of the library root. */
  readonly root: string;
  readonly stats: Readonly<WalkStats>;
  /**
   * Yields audio files under `subpath` (default: the whole root), in a stable
   * sorted order. Throws if the starting directory itself cannot be read.
   */
  walk(subpath?: string): AsyncGenerator<WalkEvent>;
  readAudio(relPath: string): Promise<AudioRead>;
}

export function createLibraryReader(root: string): LibraryReader {
  assertInsideTestSandbox(root);
  const canonicalRoot = fs.realpathSync.native(root);
  const stats: WalkStats = { skippedHidden: 0, skippedSymlinks: 0, skippedNonAudio: 0 };

  async function* walk(subpath = ''): AsyncGenerator<WalkEvent> {
    const start = path.relative(canonicalRoot, resolveInsideRoot(canonicalRoot, subpath));
    // Depth-first; children are pushed in reverse so they pop in sorted order.
    const pending: string[] = [start];
    let isStart = true;

    while (pending.length > 0) {
      const relDir = pending.pop() as string;
      let entries: fs.Dirent[];
      try {
        entries = await readSortedDir(path.join(canonicalRoot, relDir));
      } catch (error) {
        if (isStart) throw error;
        yield {
          kind: 'problem',
          relPath: relDir,
          reason: 'unreadable-directory',
          message: (error as Error).message,
        };
        continue;
      } finally {
        isStart = false;
      }

      const subdirs: string[] = [];
      for (const entry of entries) {
        const relPath = path.join(relDir, entry.name);
        if (entry.name.startsWith('.')) {
          stats.skippedHidden++; // includes AppleDouble "._*" files
          continue;
        }
        const type = await entryType(entry, path.join(canonicalRoot, relPath));
        if (type === 'symlink') {
          stats.skippedSymlinks++; // never followed: it could lead outside the root
        } else if (type === 'directory') {
          subdirs.push(relPath);
        } else if (type === 'file') {
          if (!AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            stats.skippedNonAudio++;
          } else {
            yield await describeFile(relPath);
          }
        }
        // FIFOs, sockets and devices are ignored: opening a FIFO would block.
      }
      for (let i = subdirs.length - 1; i >= 0; i--) pending.push(subdirs[i] as string);
    }
  }

  async function describeFile(relPath: string): Promise<WalkEvent> {
    // Node decodes non-UTF-8 names lossily; such a path could not be reopened.
    if (relPath.includes('�')) {
      return {
        kind: 'problem',
        relPath,
        reason: 'invalid-filename',
        message: 'File name is not valid UTF-8 and cannot be indexed reliably.',
      };
    }
    try {
      const st = await fs.promises.lstat(path.join(canonicalRoot, relPath));
      return { kind: 'file', relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    } catch (error) {
      return {
        kind: 'problem',
        relPath,
        reason: 'unreadable-file',
        message: (error as Error).message,
      };
    }
  }

  async function readAudio(relPath: string): Promise<AudioRead> {
    const absolute = resolveInsideRoot(canonicalRoot, relPath);
    const metadata = await parseFile(absolute, { duration: false, skipCovers: false });
    const fromParser = metadata.format.audioMD5;
    const audioMd5 = fromParser
      ? Buffer.from(fromParser).toString('hex')
      : metadata.format.codec === 'FLAC'
        ? flacAudioMd5(await readHeader(absolute, FLAC_HEADER_BYTES))
        : null;
    return { metadata, audioMd5 };
  }

  return { root: canonicalRoot, stats, walk, readAudio };
}

async function readSortedDir(dir: string): Promise<fs.Dirent[]> {
  const entries: fs.Dirent[] = [];
  for await (const entry of await fs.promises.opendir(dir)) entries.push(entry);
  // Code-point order: deterministic regardless of locale.
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function entryType(
  entry: fs.Dirent,
  absolute: string,
): Promise<'file' | 'directory' | 'symlink' | 'other'> {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  // Some filesystems do not report entry types; ask without following links.
  if (entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) {
    return 'other';
  }
  const st = await fs.promises.lstat(absolute);
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  return st.isFile() ? 'file' : 'other';
}

async function readHeader(absolute: string, length: number): Promise<Uint8Array> {
  const handle = await fs.promises.open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
