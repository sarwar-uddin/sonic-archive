import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Longest edge, in pixels, of each served size. */
export const ARTWORK_SIZES = { sm: 400, lg: 1200 } as const;
export type ArtworkSize = keyof typeof ARTWORK_SIZES;

/** Refuse decompression bombs: no source image above 120 megapixels. */
const MAX_INPUT_PIXELS = 120_000_000;

/**
 * Serves covers as WebP at fixed sizes, generated on first request from the
 * cached original and kept in `<artworkDir>/derived`.
 *
 * Cached originals can be 14 MB TIFF scans; a grid of them would be slow and
 * TIFF does not display in browsers. Everything here reads and writes only
 * the app's cache directory, never the music library.
 */
export function createArtworkRenderer(artworkDir: string) {
  const derivedDir = path.join(artworkDir, 'derived');
  const inFlight = new Map<string, Promise<string>>();

  async function render(cacheFile: string, size: ArtworkSize): Promise<string> {
    const sha = cacheFile.slice(0, cacheFile.indexOf('.'));
    const target = path.join(derivedDir, `${sha}-${size}.webp`);
    if (fs.existsSync(target)) return target;

    // Concurrent first requests for the same image share one conversion.
    const key = `${sha}-${size}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        await fs.promises.mkdir(derivedDir, { recursive: true, mode: 0o700 });
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await sharp(path.join(artworkDir, cacheFile), { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate() // honour EXIF orientation from camera-made scans
          .resize(ARTWORK_SIZES[size], ARTWORK_SIZES[size], {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: size === 'sm' ? 78 : 84 })
          .toFile(temp);
        await fs.promises.rename(temp, target);
        return target;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  return { render };
}
