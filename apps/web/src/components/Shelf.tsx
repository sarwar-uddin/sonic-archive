import type { AlbumSummary } from '@sonic-archive/contracts';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useCoverColor } from '../lib/cover-color.ts';
import { editionText } from './AlbumGrid.tsx';
import { hue } from './Cover.tsx';
import styles from './Shelf.module.css';

/** A catalogue number from the pressing details ("TECP-23893", "32DP 448"), if any. */
export function catalogueNumber(edition: readonly string[]): string | null {
  for (const group of edition) {
    const match = /\b([A-Z]{1,8}[- ]?\d{2,}[\w-]*|\d+[A-Z]{1,4}[- ]?\d{2,})\b/.exec(group);
    if (match) return match[1] ?? null;
  }
  return null;
}

/**
 * The collection as CD spines on shelves: each spine in its cover's color,
 * artist and title running up it, an OBI band on Japanese pressings with an
 * OBI scan, double width for double albums. When sorted by artist, paper
 * tabs divide the shelf by letter, as in a record shop.
 */
export function Shelf({
  albums,
  groupByArtist,
}: {
  readonly albums: readonly AlbumSummary[];
  readonly groupByArtist: boolean;
}) {
  let lastLetter: string | undefined;
  return (
    <ol className={styles.shelf} aria-label="Albums on the shelf">
      {albums.flatMap((album) => {
        const letter = shelfLetter(album.albumArtist?.name ?? null);
        const items = [];
        if (groupByArtist && letter !== lastLetter) {
          items.push(
            <li key={`tab-${album.id}`} className={styles.tab} aria-hidden="true">
              <span>{letter}</span>
            </li>,
          );
        }
        lastLetter = letter;
        items.push(<Spine key={album.id} album={album} />);
        return items;
      })}
    </ol>
  );
}

/** The divider letter for an artist: "Ísold" → "I", "The Doors" → "D", "2Pac" → "#". */
export function shelfLetter(artist: string | null): string {
  if (artist === null) return '?';
  const first = artist
    .replace(/^the\s+/i, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .charAt(0)
    .toLocaleUpperCase();
  return /\p{L}/u.test(first) ? first : '#';
}

function Spine({ album }: { album: AlbumSummary }) {
  const artist = album.albumArtist?.name ?? null;
  const color = useCoverColor(album.artworkId, hue(album.title));
  const code = catalogueNumber(album.edition);
  const double = album.durationMs > 82 * 60 * 1000;
  const label = [artist, album.title, album.year].filter(Boolean).join(' · ');
  return (
    <li className={double ? styles.double : undefined}>
      <Link
        to={`/albums/${album.id}`}
        className={styles.spine}
        style={{ '--spine': color.background, '--ink': color.ink } as CSSProperties}
        aria-label={label}
      >
        {album.obi && <span className={styles.obi} aria-hidden="true" />}
        <span className={styles.text} aria-hidden="true">
          {artist && <strong>{artist}</strong>}
          <span>{album.title}</span>
        </span>
        <span className={`mono ${styles.foot}`} aria-hidden="true">
          {code ?? album.year ?? ''}
        </span>
        <span className={styles.tip} aria-hidden="true">
          <strong>{album.title}</strong>
          {artist}
          {album.edition.length > 0 && <em>{editionText(album.edition, album.year)}</em>}
        </span>
      </Link>
    </li>
  );
}
