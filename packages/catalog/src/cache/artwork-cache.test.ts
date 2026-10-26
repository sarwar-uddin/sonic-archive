import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTWORK_SUBDIR, MAX_ARTWORK_BYTES, storeArtwork } from './artwork-cache.ts';

let cacheDir: string;

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-cache-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('storeArtwork', () => {
  it('writes the image under <cacheDir>/artwork named by its hash', () => {
    const stored = storeArtwork(cacheDir, { mime: 'image/jpeg', data: JPEG });
    expect(stored).toMatchObject({ mime: 'image/jpeg', byteSize: JPEG.length, source: 'embedded' });
    const file = path.join(cacheDir, ARTWORK_SUBDIR, stored?.cacheFile ?? '');
    expect(stored?.cacheFile).toBe(`${stored?.sha256}.jpg`);
    expect(new Uint8Array(fs.readFileSync(file))).toEqual(JPEG);
  });

  it('stores identical images once and leaves no temp files', () => {
    const a = storeArtwork(cacheDir, { mime: 'image/jpeg', data: JPEG });
    const b = storeArtwork(cacheDir, { mime: 'image/jpeg', data: JPEG });
    expect(b).toEqual(a);
    expect(fs.readdirSync(path.join(cacheDir, ARTWORK_SUBDIR))).toEqual([a?.cacheFile]);
  });

  it('accepts TIFF scans in both byte orders', () => {
    const le = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
    const be = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
    expect(storeArtwork(cacheDir, { data: le }, 'folder')).toMatchObject({
      mime: 'image/tiff',
      source: 'folder',
    });
    expect(storeArtwork(cacheDir, { data: be })?.cacheFile).toMatch(/\.tif$/);
  });

  it('trusts the bytes over the tag', () => {
    expect(storeArtwork(cacheDir, { mime: 'image/jpeg', data: PNG })?.mime).toBe('image/png');
  });

  it.each([
    ['SVG (could carry script)', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['HTML', 'text/html', '<script>alert(1)</script>'],
    ['unknown bytes', 'image/jpeg', 'not an image'],
  ])('rejects %s', (_, mime, text) => {
    expect(storeArtwork(cacheDir, { mime, data: new TextEncoder().encode(text) })).toBeNull();
    expect(fs.existsSync(path.join(cacheDir, ARTWORK_SUBDIR))).toBe(false);
  });

  it('rejects empty and oversized images', () => {
    expect(storeArtwork(cacheDir, { mime: 'image/jpeg', data: new Uint8Array() })).toBeNull();
    const huge = new Uint8Array(MAX_ARTWORK_BYTES + 1);
    huge.set(JPEG);
    expect(storeArtwork(cacheDir, { mime: 'image/jpeg', data: huge })).toBeNull();
  });
});
