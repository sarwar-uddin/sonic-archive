import type { AlbumDetail } from '@sonic-archive/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Cover } from '../components/Cover.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { api } from '../lib/api.ts';
import {
  formatBytes,
  formatLongDuration,
  formatResolution,
  formatSampleRate,
  plural,
  shortCodec,
} from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './AlbumPage.module.css';
import { NotFoundPage } from './NotFoundPage.tsx';

export function AlbumPage() {
  const id = Number(useParams().id);
  const album = useQuery({
    queryKey: ['album', id],
    queryFn: ({ signal }) => api.album(id, signal),
    enabled: Number.isInteger(id) && id > 0,
  });
  useDocumentTitle(album.data?.title);

  if (!Number.isInteger(id) || id <= 0) return <NotFoundPage />;
  if (album.isPending) return <Loading label="Taking it off the shelf" />;
  if (album.isError) {
    if ((album.error as { status?: number }).status === 404) return <NotFoundPage />;
    return <ErrorMessage error={album.error} retry={() => album.refetch()} />;
  }
  return <AlbumView album={album.data} />;
}

export function AlbumView({ album }: { readonly album: AlbumDetail }) {
  const artist = album.albumArtist?.name ?? null;
  return (
    <article className={styles.album}>
      <div className={styles.sleeve}>
        <Cover artworkId={album.artworkId} title={album.title} artist={artist} size="lg" eager />
      </div>
      <div className={styles.notes}>
        <header className={styles.header}>
          <p className="kicker">{album.year ?? 'Year unknown'}</p>
          <h1 className={styles.title}>{album.title}</h1>
          <p className={styles.artist}>
            {album.albumArtist ? (
              <Link to={`/artists/${album.albumArtist.id}`}>{album.albumArtist.name}</Link>
            ) : (
              'Unknown artist'
            )}
          </p>
          {album.genres.length > 0 && (
            <ul className={styles.genres} aria-label="Genres">
              {album.genres.map((genre) => (
                <li key={genre.id}>
                  <Link to={`/?genre=${genre.id}`}>{genre.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </header>

        <TrackList discs={album.discs} albumArtist={artist} />

        <section className={styles.specSheet} aria-labelledby="spec-heading">
          <h2 id="spec-heading" className="kicker">
            Specification
          </h2>
          <dl>
            <dt>Format</dt>
            <dd>{album.codecs.map(shortCodec).join(', ') || '—'}</dd>
            <dt>Resolution</dt>
            <dd>
              {album.maxBitDepth ? `${album.maxBitDepth} bit / ` : ''}
              {formatSampleRate(album.maxSampleRate)}
              <span className={styles.compact}>
                {formatResolution(album.maxBitDepth, album.maxSampleRate)}
              </span>
            </dd>
            <dt>Fidelity</dt>
            <dd>{album.lossless ? 'Lossless' : 'Contains lossy tracks'}</dd>
            <dt>Tracks</dt>
            <dd>
              {plural(album.trackCount, 'track')}
              {album.totalDiscs && album.totalDiscs > 1 ? ` on ${album.totalDiscs} discs` : ''}
            </dd>
            <dt>Running time</dt>
            <dd>{formatLongDuration(album.durationMs)}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(album.totalBytes)}</dd>
            {album.musicbrainzAlbumId && (
              <>
                <dt>MusicBrainz</dt>
                <dd className={styles.wrap}>{album.musicbrainzAlbumId}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </article>
  );
}
