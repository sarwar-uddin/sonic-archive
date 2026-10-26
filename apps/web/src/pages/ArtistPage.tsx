import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { AlbumGrid } from '../components/AlbumGrid.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api, artworkUrl } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './ArtistPage.module.css';
import { NotFoundPage } from './NotFoundPage.tsx';
import page from './page.module.css';

export function ArtistPage() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const artist = useQuery({
    queryKey: ['artist', id],
    queryFn: ({ signal }) => api.artist(id, signal),
    enabled: valid,
  });
  useDocumentTitle(artist.data?.name);

  if (!valid) return <NotFoundPage />;
  if (artist.isPending) return <Loading />;
  if (artist.isError) {
    if ((artist.error as { status?: number }).status === 404) return <NotFoundPage />;
    return <ErrorMessage error={artist.error} retry={() => artist.refetch()} />;
  }

  const { name, albums, appearsOn, trackCount } = artist.data;
  const backdrop = [...albums, ...appearsOn].find((a) => a.artworkId !== null)?.artworkId ?? null;
  const years = albums.map((a) => a.year).filter((y): y is number => y !== null);
  const span =
    years.length > 0
      ? Math.min(...years) === Math.max(...years)
        ? String(years[0])
        : `${Math.min(...years)}–${Math.max(...years)}`
      : null;

  return (
    <>
      <header className={styles.hero}>
        {backdrop !== null && (
          <img
            className={styles.backdrop}
            src={artworkUrl(backdrop, 'sm')}
            alt=""
            aria-hidden="true"
          />
        )}
        <div className={styles.heroInner}>
          <p className="kicker">Artist{span ? ` · ${span}` : ''}</p>
          <h1 className={page.title}>{name}</h1>
          <p className={`mono ${styles.facts}`}>
            <span>{plural(albums.length, 'release')}</span>
            {appearsOn.length > 0 && <span>{plural(appearsOn.length, 'appearance')}</span>}
            <span>{plural(trackCount, 'track')}</span>
          </p>
        </div>
      </header>
      {albums.length > 0 && (
        <section aria-labelledby="discography">
          <h2 id="discography" className={page.sectionTitle}>
            Discography <span className={page.count}>{albums.length}</span>
          </h2>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {appearsOn.length > 0 && (
        <section className={page.section} aria-labelledby="appears-on">
          <h2 id="appears-on" className={page.sectionTitle}>
            Appears on <span className={page.count}>{appearsOn.length}</span>
          </h2>
          <AlbumGrid albums={appearsOn} />
        </section>
      )}
    </>
  );
}
