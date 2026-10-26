import type { AlbumDetail, AlbumSummary } from '@sonic-archive/contracts';
import { Link } from 'react-router';
import { formatLongDuration, plural } from '../lib/format.ts';
import { editionText, SpecTag } from './AlbumGrid.tsx';
import { Cover } from './Cover.tsx';
import styles from './Pressings.module.css';
import { RipStamp } from './RipLogs.tsx';

/**
 * Every pressing of this album in the collection side by side, so a
 * Japanese first press and a later reissue can be compared at a glance.
 */
export function Pressings({ album }: { readonly album: AlbumDetail }) {
  const rows = [album, ...album.otherPressings].sort(
    (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id - b.id,
  );
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Pressing</th>
          <th scope="col">Year</th>
          <th scope="col">Format</th>
          <th scope="col">Tracks</th>
          <th scope="col">Length</th>
          <th scope="col">Rip</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <PressingRow key={row.id} album={row} current={row.id === album.id} />
        ))}
      </tbody>
    </table>
  );
}

function PressingRow({ album, current }: { album: AlbumSummary; current: boolean }) {
  const edition = editionText(album.edition, album.year) || 'No pressing details';
  return (
    <tr aria-current={current ? 'true' : undefined} className={current ? styles.current : ''}>
      <th scope="row">
        <span className={styles.sleeve}>
          <Cover
            artworkId={album.artworkId}
            title={album.title}
            artist={album.albumArtist?.name ?? null}
          />
        </span>
        <span className={styles.name}>
          {current ? (
            <span className="mono">{edition}</span>
          ) : (
            <Link className="mono" to={`/albums/${album.id}`}>
              {edition}
            </Link>
          )}
          {current && <span className="kicker">This copy</span>}
        </span>
      </th>
      <td className="mono">{album.year ?? '—'}</td>
      <td>
        <SpecTag album={album} />
      </td>
      <td className="mono">{plural(album.trackCount, 'track')}</td>
      <td className="mono">{formatLongDuration(album.durationMs)}</td>
      <td>{album.rip ? <RipStamp verdict={album.rip} /> : <span className="mono">—</span>}</td>
    </tr>
  );
}
