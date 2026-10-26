import { useState } from 'react';
import { artworkUrl } from '../lib/api.ts';
import styles from './Cover.module.css';

interface CoverProps {
  readonly artworkId: number | null;
  readonly title: string;
  readonly artist: string | null;
  /** Rendered width hint in CSS pixels, for the browser's image decoding. */
  readonly size?: number;
  readonly eager?: boolean;
}

/**
 * Album artwork, or a typeset placeholder sleeve when there is none (or it
 * fails to load). The placeholder tint is derived from the title, so the same
 * album always gets the same sleeve.
 */
export function Cover({ artworkId, title, artist, size = 240, eager = false }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const label = artist ? `${title} by ${artist}` : title;

  if (artworkId !== null && !failed) {
    return (
      <img
        className={styles.cover}
        src={artworkUrl(artworkId)}
        alt={`Cover of ${label}`}
        width={size}
        height={size}
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
      <span className={styles.placeholderTitle}>{title}</span>
      {artist && <span className={styles.placeholderArtist}>{artist}</span>}
    </div>
  );
}

function hue(text: string): number {
  let h = 0;
  for (const char of text) h = (h * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return h;
}
