import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { AlbumGrid } from '../components/AlbumGrid.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './page.module.css';

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
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headline}>
          <p className="kicker">Artist</p>
          <h1 className={styles.title}>{name}</h1>
          <p className="kicker">
            {plural(albums.length + appearsOn.length, 'album')} · {plural(trackCount, 'track')}
          </p>
        </div>
      </header>
      {albums.length > 0 && (
        <section aria-labelledby="own-albums">
          <h2 id="own-albums" className="visually-hidden">
            Albums
          </h2>
          <AlbumGrid albums={albums} />
        </section>
      )}
      {appearsOn.length > 0 && (
        <section className={styles.section} aria-labelledby="appears-on">
          <h2 id="appears-on" className={styles.sectionTitle}>
            Appears on <span className={styles.count}>{appearsOn.length}</span>
          </h2>
          <AlbumGrid albums={appearsOn} />
        </section>
      )}
    </>
  );
}
