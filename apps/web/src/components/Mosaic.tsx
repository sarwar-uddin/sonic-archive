import { artworkUrl } from '../lib/api.ts';
import styles from './Mosaic.module.css';

const LAYOUT = ['', styles.one, styles.two, styles.three, styles.four] as const;

/**
 * Up to four distinct covers in a square: one fills it, two sit side by
 * side, three give the first the left half, four tile 2×2. With none, the
 * artist's initial is set like a divider card.
 */
export function Mosaic({ artworkIds, name }: { artworkIds: readonly number[]; name: string }) {
  const ids = [...new Set(artworkIds)].slice(0, 4);
  if (ids.length === 0) {
    return (
      <div className={`${styles.mosaic} ${styles.empty}`} aria-hidden="true">
        <span>{name.trim().charAt(0) || '?'}</span>
      </div>
    );
  }
  return (
    <div className={`${styles.mosaic} ${LAYOUT[ids.length]}`} aria-hidden="true">
      {ids.map((id) => (
        <img key={id} src={artworkUrl(id, 'sm')} alt="" loading="lazy" decoding="async" />
      ))}
    </div>
  );
}
