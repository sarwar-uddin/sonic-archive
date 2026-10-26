import type { SearchResults } from '@sonic-archive/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AlbumGrid } from '../components/AlbumGrid.tsx';
import { ErrorMessage, Loading, NoResults } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { formatDuration, formatResolution, plural } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './page.module.css';
import search from './SearchPage.module.css';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  useDocumentTitle(q ? `“${q}”` : 'Search');
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  });

  if (q === '') return <NoResults>Type in the search box above.</NoResults>;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headline}>
          <p className="kicker">Search</p>
          <h1 className={styles.title}>
            <em>“</em>
            {q}
            <em>”</em>
          </h1>
        </div>
      </header>

      {results.isPending ? (
        <Loading label="Looking through the crates" />
      ) : results.isError ? (
        <ErrorMessage error={results.error} retry={() => results.refetch()} />
      ) : (
        <Results data={results.data} q={q} />
      )}
    </>
  );
}

function Results({ data, q }: { data: SearchResults; q: string }) {
  if (data.albums.length + data.artists.length + data.tracks.length === 0) {
    return <NoResults>Nothing in the archive matches “{q}”.</NoResults>;
  }
  return (
    <>
      {data.artists.length > 0 && (
        <section aria-labelledby="r-artists">
          <h2 id="r-artists" className={styles.sectionTitle}>
            Artists <span className={styles.count}>{data.artists.length}</span>
          </h2>
          <ul className={search.artists}>
            {data.artists.map((a) => (
              <li key={a.id}>
                <Link to={`/artists/${a.id}`}>{a.name}</Link>
                <span className="mono">{plural(a.albumCount, 'album')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.albums.length > 0 && (
        <section className={styles.section} aria-labelledby="r-albums">
          <h2 id="r-albums" className={styles.sectionTitle}>
            Albums <span className={styles.count}>{data.albums.length}</span>
          </h2>
          <AlbumGrid albums={data.albums} />
        </section>
      )}
      {data.tracks.length > 0 && (
        <section className={styles.section} aria-labelledby="r-tracks">
          <h2 id="r-tracks" className={styles.sectionTitle}>
            Tracks <span className={styles.count}>{data.tracks.length}</span>
          </h2>
          <ol className={search.tracks}>
            {data.tracks.map((t) => (
              <li key={t.id}>
                <span className={search.trackTitle}>
                  {t.album ? (
                    <Link to={`/albums/${t.album.id}`}>{t.title ?? 'Untitled'}</Link>
                  ) : (
                    t.title
                  )}
                </span>
                <span className={search.trackMeta}>
                  {t.displayArtist ?? 'Unknown artist'}
                  {t.album && <> · {t.album.title}</>}
                </span>
                <span className="mono">{formatResolution(t.bitDepth, t.sampleRate)}</span>
                <span className="mono">{formatDuration(t.durationMs)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
