import type { AlbumSummary } from '@sonic-archive/contracts';
import { Link } from 'react-router';
import { formatResolution, isHiRes, plural, shortCodec } from '../lib/format.ts';
import styles from './AlbumGrid.module.css';
import { Cover } from './Cover.tsx';

interface AlbumGridProps {
  readonly albums: readonly AlbumSummary[];
  /**
   * Split the grid under artist dividers, like the name cards in a record
   * shop's bins. Expects albums sorted by artist.
   */
  readonly groupByArtist?: boolean;
}

export function AlbumGrid({ albums, groupByArtist = false }: AlbumGridProps) {
  if (!groupByArtist) {
    return (
      <ul className={styles.grid}>
        {albums.map((album, index) => (
          <li key={album.id}>
            <AlbumCard album={album} eager={index < 8} />
          </li>
        ))}
      </ul>
    );
  }

  // Divider cards stand in the grid between artists, as in a record shop's
  // bins, so a collection of mostly one-record artists stays dense.
  let index = 0;
  return (
    <ul className={styles.grid}>
      {binsByArtist(albums).map((bin) => [
        <li key={`divider-${bin.key}`} className={styles.dividerItem}>
          <DividerCard bin={bin} />
        </li>,
        ...bin.albums.map((album) => (
          <li key={album.id}>
            <AlbumCard album={album} eager={index++ < 8} showArtist={false} />
          </li>
        )),
      ])}
    </ul>
  );
}

function DividerCard({ bin }: { bin: Bin }) {
  const body = (
    <>
      <span className={styles.dividerTab} aria-hidden="true" />
      <h2 className={styles.dividerName}>{bin.name}</h2>
      <span className={`mono ${styles.dividerCount}`}>{plural(bin.albums.length, 'release')}</span>
    </>
  );
  return bin.artistId === null ? (
    <div className={styles.divider}>{body}</div>
  ) : (
    <Link to={`/artists/${bin.artistId}`} className={styles.divider}>
      {body}
    </Link>
  );
}

interface Bin {
  key: string;
  artistId: number | null;
  name: string;
  albums: AlbumSummary[];
}

/** Consecutive albums by the same album artist share a bin. */
export function binsByArtist(albums: readonly AlbumSummary[]): Bin[] {
  const bins: Bin[] = [];
  for (const album of albums) {
    const artistId = album.albumArtist?.id ?? null;
    const last = bins.at(-1);
    if (last && last.artistId === artistId) last.albums.push(album);
    else {
      bins.push({
        key: `${artistId ?? 'none'}-${album.id}`,
        artistId,
        name: album.albumArtist?.name ?? 'Unknown artist',
        albums: [album],
      });
    }
  }
  return bins;
}

export function AlbumCard({
  album,
  eager = false,
  showArtist = true,
}: {
  readonly album: AlbumSummary;
  readonly eager?: boolean;
  readonly showArtist?: boolean;
}) {
  const artist = album.albumArtist?.name ?? null;
  const edition = editionText(album.edition, album.year);
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
      {showArtist && (
        <p className={styles.artist}>
          {album.albumArtist ? (
            <Link to={`/artists/${album.albumArtist.id}`}>{album.albumArtist.name}</Link>
          ) : (
            'Unknown artist'
          )}
        </p>
      )}
      <p className={styles.meta}>
        <span className="mono">{album.year ?? '—'}</span>
        <SpecTag album={album} />
      </p>
      {edition && (
        <p className={`mono ${styles.edition}`} title={edition}>
          {edition}
        </p>
      )}
    </article>
  );
}

/** Edition groups joined, without a leading year that repeats the album's. */
export function editionText(edition: readonly string[], year: number | null): string {
  return edition
    .map((e) => (year !== null ? e.replace(new RegExp(`^${year}\\s*[·,]\\s*`), '') : e))
    .filter(Boolean)
    .join(' · ');
}

/** "FLAC 24/96", in the accent when hi-res; codecs joined when mixed. */
export function SpecTag({ album }: { readonly album: AlbumSummary }) {
  const hiRes = isHiRes(album.maxBitDepth, album.maxSampleRate);
  return (
    <span className={`tag ${hiRes ? 'tag-hires' : ''}`}>
      {album.codecs.map(shortCodec).join('+') || '—'}{' '}
      {formatResolution(album.maxBitDepth, album.maxSampleRate)}
    </span>
  );
}
