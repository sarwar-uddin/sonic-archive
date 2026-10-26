import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderError, listFolders } from './folders.ts';

let base: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-folders-')));
  fs.mkdirSync(path.join(base, 'Music/Jazz'), { recursive: true });
  fs.mkdirSync(path.join(base, 'Music/Rock'));
  fs.mkdirSync(path.join(base, 'Music/.hidden'));
  fs.writeFileSync(path.join(base, 'Music/track.flac'), 'x');
  fs.symlinkSync(path.join(base, 'Music/Rock'), path.join(base, 'Music/Link to Rock'));
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('listFolders', () => {
  it('lists subfolder names only: no files, nothing hidden, links to folders included', () => {
    const listing = listFolders(path.join(base, 'Music'), base);
    expect(listing.path).toBe(path.join(base, 'Music'));
    expect(listing.parent).toBe(base);
    expect(listing.folders.map((f) => f.name)).toEqual(['Jazz', 'Link to Rock', 'Rock']);
    expect(listing.places).toContainEqual({ name: 'Home', path: base });
    expect(listing.places).toContainEqual({ name: 'Music', path: path.join(base, 'Music') });
  });

  it('starts at the home folder and explains what it cannot open', () => {
    expect(listFolders(undefined, base).path).toBe(base);
    expect(() => listFolders('relative', base)).toThrow(FolderError);
    expect(() => listFolders(path.join(base, 'nope'), base)).toThrow('does not exist');
    expect(() => listFolders(path.join(base, 'Music/track.flac'), base)).toThrow('does not exist');
    expect(listFolders('/', base).parent).toBeNull();
  });
});
