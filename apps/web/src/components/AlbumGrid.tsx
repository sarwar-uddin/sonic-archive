import type { AlbumSummary } from '@sonic-archive/contracts';
import { Link } from 'react-router';
import { formatResolution, isHiRes, shortCodec } from '../lib/format.ts';
import styles from './AlbumGrid.module.css';
import { Cover } from './Cover.tsx';

export function AlbumGrid({ albums }: { readonly albums: readonly AlbumSummary[] }) {
  return (
    <ul className={styles.grid}>
      {albums.map((album, index) => (
        <li key={album.id}>
          <AlbumCard album={album} eager={index < 6} />
        </li>
      ))}
    </ul>
  );
}

export function AlbumCard({
  album,
  eager = false,
}: {
  readonly album: AlbumSummary;
  readonly eager?: boolean;
}) {
  const artist = album.albumArtist?.name ?? null;
  return (
    <article className={styles.card}>
      <Link
        to={`/albums/${album.id}`}
        className={styles.coverLink}
        tabIndex={-1}
        aria-hidden="true"
      >
        <Cover artworkId={album.artworkId} title={album.title} artist={artist} eager={eager} />
      </Link>
      <h3 className={styles.title}>
        <Link to={`/albums/${album.id}`}>{album.title}</Link>
      </h3>
      <p className={styles.artist}>
        {album.albumArtist ? (
          <Link to={`/artists/${album.albumArtist.id}`}>{album.albumArtist.name}</Link>
        ) : (
          'Unknown artist'
        )}
      </p>
      <p className={styles.meta}>
        <span>{album.year ?? '—'}</span>
        <SpecTag album={album} />
      </p>
    </article>
  );
}

/** "FLAC 24/96", highlighted when hi-res; codecs joined when mixed. */
export function SpecTag({ album }: { readonly album: AlbumSummary }) {
  const hiRes = isHiRes(album.maxBitDepth, album.maxSampleRate);
  return (
    <span className={`mono ${styles.spec} ${hiRes ? styles.hiRes : ''}`}>
      {album.codecs.map(shortCodec).join('+') || '—'}{' '}
      {formatResolution(album.maxBitDepth, album.maxSampleRate)}
    </span>
  );
}
