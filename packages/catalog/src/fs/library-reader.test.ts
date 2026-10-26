import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFixtureLibrary, FIXTURE_AUDIO_COUNT, type LibraryCopy } from '../testing/fixtures.ts';
import { createLibraryReader, type WalkEvent } from './library-reader.ts';

let lib: LibraryCopy;

beforeEach(() => {
  lib = copyFixtureLibrary();
});

afterEach(() => {
  lib.cleanup();
});

async function collect(iterable: AsyncIterable<WalkEvent>): Promise<WalkEvent[]> {
  const out: WalkEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe('createLibraryReader', () => {
  it('refuses roots outside the test sandbox while tests run', () => {
    expect(() => createLibraryReader(import.meta.dirname)).toThrowError(
      expect.objectContaining({ code: 'ROOT_OUTSIDE_TEST_SANDBOX' }),
    );
  });
});

describe('walk', () => {
  it('yields audio files in a stable, sorted, depth-first order', async () => {
    const reader = createLibraryReader(lib.root);
    const first = await collect(reader.walk());
    const second = await collect(createLibraryReader(lib.root).walk());
    expect(first).toEqual(second);
    expect(first).toHaveLength(FIXTURE_AUDIO_COUNT);
    expect(first.slice(0, 3).map((e) => e.relPath)).toEqual([
      'Aurora Field/Northern Lines (2001)/01 First Light.flac',
      'Aurora Field/Northern Lines (2001)/02 Polar Night.flac',
      'Basalt Quartet/Hi-Res Session (2020)/01 Overture.flac',
    ]);
  });

  it('reports size and whole-millisecond mtime', async () => {
    const [entry] = await collect(createLibraryReader(lib.root).walk('Untagged'));
    const st = fs.statSync(path.join(lib.root, 'Untagged/unknown.flac'));
    expect(entry).toEqual({
      kind: 'file',
      relPath: 'Untagged/unknown.flac',
      size: st.size,
      mtimeMs: Math.floor(st.mtimeMs),
    });
  });

  it('matches extensions case-insensitively', async () => {
    fs.copyFileSync(
      path.join(lib.root, 'Untagged/unknown.flac'),
      path.join(lib.root, 'Untagged/LOUD.FLAC'),
    );
    const events = await collect(createLibraryReader(lib.root).walk('Untagged'));
    expect(events.map((e) => e.relPath)).toEqual(['Untagged/LOUD.FLAC', 'Untagged/unknown.flac']);
  });

  it('reports a file name that is not valid UTF-8 instead of indexing it', async () => {
    const dir = Buffer.from(path.join(lib.root, 'Untagged/'));
    fs.writeFileSync(
      Buffer.concat([dir, Buffer.from([0x62, 0xff, 0x2e]), Buffer.from('flac')]),
      '',
    );
    const events = await collect(createLibraryReader(lib.root).walk('Untagged'));
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'problem', reason: 'invalid-filename' }),
    );
  });

  it('ignores FIFOs rather than blocking on them', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [path.join(lib.root, 'Untagged/pipe.flac')]);
    const events = await collect(createLibraryReader(lib.root).walk('Untagged'));
    expect(events.map((e) => e.relPath)).toEqual(['Untagged/unknown.flac']);
  });

  it('throws when the starting folder cannot be read', async () => {
    const reader = createLibraryReader(lib.root);
    fs.rmSync(lib.root, { recursive: true });
    await expect(collect(reader.walk())).rejects.toThrow();
  });
});

describe('readAudio', () => {
  it('parses tags and the FLAC audio MD5', async () => {
    const reader = createLibraryReader(lib.root);
    const { metadata, audioMd5 } = await reader.readAudio(
      'Aurora Field/Northern Lines (2001)/01 First Light.flac',
    );
    expect(metadata.common.title).toBe('First Light');
    expect(audioMd5).toBe('f92951abe8308de3f54a91cda07e7faa');
  });

  it('refuses paths outside the root', async () => {
    const reader = createLibraryReader(lib.root);
    await expect(reader.readAudio('../outside/x.flac')).rejects.toThrow(/outside the library/);
  });
});

describe('audio for playback', () => {
  const FLAC = 'Aurora Field/Northern Lines (2001)/01 First Light.flac';

  it('reads a byte range of an audio file', async () => {
    const reader = createLibraryReader(lib.root);
    const { size } = await reader.audioFile(FLAC);
    expect(size).toBe(fs.statSync(path.join(lib.root, FLAC)).size);
    const chunks: Buffer[] = [];
    for await (const chunk of await reader.readAudioRange(FLAC, 0, 3)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('latin1')).toBe('fLaC');
  });

  it('refuses non-audio files, folders, escapes and links leading outside', async () => {
    const reader = createLibraryReader(lib.root);
    fs.writeFileSync(path.join(lib.outside, 'secret.flac'), 'x');
    fs.symlinkSync(path.join(lib.outside, 'secret.flac'), path.join(lib.root, 'link.flac'));
    await expect(
      reader.audioFile('Aurora Field/Northern Lines (2001)/notes.txt'),
    ).rejects.toThrow();
    await expect(reader.audioFile('Aurora Field')).rejects.toThrow();
    await expect(reader.audioFile('../outside/secret.flac')).rejects.toThrow();
    await expect(reader.audioFile('link.flac')).rejects.toThrow();
    await expect(reader.readAudioRange('../outside/secret.flac', 0, 0)).rejects.toThrow();
  });
});
