import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NewArtwork } from '../db/catalog-repository.ts';
import type { PictureRecord } from '../metadata/map.ts';

export const ARTWORK_SUBDIR = 'artwork';

/** Larger embedded images are almost certainly corrupt tags; skip them. */
export const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;

const SIGNATURES: readonly { mime: string; ext: string; matches: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/png', ext: 'png', matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  { mime: 'image/gif', ext: 'gif', matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

/**
 * Copies a cover image into the app's cache dir (never the library),
 * named by its SHA-256 so identical covers are stored once.
 *
 * The type is taken from the image bytes, not the tag's claim, and only
 * raster formats are accepted. These files will later be served to the
 * browser, and a tag claiming `image/svg+xml` or `text/html` must never
 * become active content.
 */
export function storeArtwork(
  cacheDir: string,
  /** `mime` (the tag's claim) is ignored; the type comes from the bytes. */
  picture: Pick<PictureRecord, 'data'> & Partial<Pick<PictureRecord, 'mime'>>,
  source: NewArtwork['source'] = 'embedded',
): NewArtwork | null {
  const { data } = picture;
  if (data.length === 0 || data.length > MAX_ARTWORK_BYTES) return null;
  const type = SIGNATURES.find((s) => s.matches(data));
  if (!type) return null;

  const sha256 = createHash('sha256').update(data).digest('hex');
  const cacheFile = `${sha256}.${type.ext}`;
  const dir = path.join(cacheDir, ARTWORK_SUBDIR);
  const target = path.join(dir, cacheFile);

  if (!fs.existsSync(target)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Write then rename, so a crash never leaves a truncated image behind.
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, target);
  }

  return {
    sha256,
    mime: type.mime,
    width: null,
    height: null,
    byteSize: data.length,
    source,
    cacheFile,
  };
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}
