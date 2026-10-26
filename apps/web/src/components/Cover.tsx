import { useState } from 'react';
import { artworkUrl } from '../lib/api.ts';
import styles from './Cover.module.css';

interface CoverProps {
  readonly artworkId: number | null;
  readonly title: string;
  readonly artist: string | null;
  /** `sm` for grids and lists, `lg` for the album page. */
  readonly size?: 'sm' | 'lg';
  readonly eager?: boolean;
}

/**
 * Album artwork, or a plain printed sleeve when there is none (or it fails
 * to load). The sleeve tint comes from the title, so an album always gets
 * the same one.
 */
export function Cover({ artworkId, title, artist, size = 'sm', eager = false }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const label = artist ? `${title} by ${artist}` : title;

  if (artworkId !== null && !failed) {
    return (
      <img
        className={styles.cover}
        src={artworkUrl(artworkId, size)}
        alt={`Cover of ${label}`}
        width={size === 'sm' ? 400 : 1200}
        height={size === 'sm' ? 400 : 1200}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${styles.cover} ${styles.placeholder}`}
      style={{ '--hue': String(hue(title)) } as React.CSSProperties}
      role="img"
      aria-label={`No cover for ${label}`}
    >
      <span className={styles.disc} aria-hidden="true" />
      {artist && <span className={styles.placeholderArtist}>{artist}</span>}
      <span className={styles.placeholderTitle}>{title}</span>
    </div>
  );
}

/** A stable hue (0–359) from text: the same album always gets the same tint. */
export function hue(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return h;
}
