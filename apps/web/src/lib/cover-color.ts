import { useEffect, useState } from 'react';
import { artworkUrl } from './api.ts';

export interface SpineColor {
  readonly background: string;
  /** Text color with enough contrast on `background`. */
  readonly ink: string;
}

const cache = new Map<number, SpineColor>();

/** A muted spine color from a hue, for albums without a cover. */
export function fallbackColor(hue: number): SpineColor {
  return { background: `hsl(${hue} 28% 30%)`, ink: '#ece7db' };
}

/**
 * The cover's most vivid average color, from its 400 px thumbnail drawn at
 * 16×16 in the browser (same-origin, so the canvas may be read). Pixels are
 * weighted by saturation, so a red title on a black sleeve still reads red.
 */
export function colorFromPixels(data: Uint8ClampedArray): SpineColor | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [pr, pg, pb, pa] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
    if (pa < 128) continue;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const w = 0.15 + (max === 0 ? 0 : (max - min) / max);
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }
  if (weight === 0) return null;
  const [cr, cg, cb] = [r / weight, g / weight, b / weight].map(Math.round) as [
    number,
    number,
    number,
  ];
  // Relative luminance decides the ink: dark text on light spines.
  const lum = (0.2126 * cr + 0.7152 * cg + 0.0722 * cb) / 255;
  return { background: `rgb(${cr} ${cg} ${cb})`, ink: lum > 0.55 ? '#0d0d0c' : '#ece7db' };
}

export function useCoverColor(artworkId: number | null, hue: number): SpineColor {
  const [color, setColor] = useState<SpineColor>(
    () => (artworkId !== null ? cache.get(artworkId) : undefined) ?? fallbackColor(hue),
  );
  useEffect(() => {
    if (artworkId === null || cache.has(artworkId)) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 16);
      const found = colorFromPixels(context.getImageData(0, 0, 16, 16).data);
      if (!found) return;
      cache.set(artworkId, found);
      if (!cancelled) setColor(found);
    };
    image.src = artworkUrl(artworkId, 'sm');
    return () => {
      cancelled = true;
    };
  }, [artworkId]);
  return color;
}
