import type { ArtistSummary } from '@sonic-archive/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Mosaic } from '../components/Mosaic.tsx';
import { Pager } from '../components/Pager.tsx';
import { ErrorMessage, Loading, NoResults } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './ArtistsPage.module.css';
import page from './page.module.css';

const LIMIT = 500;

export function ArtistsPage() {
  useDocumentTitle('Artists');
  const [params, setParams] = useSearchParams();
  const filter = params.get('q') ?? '';
  const deferredFilter = useDeferredValue(filter.trim());
  const pageNo = Math.max(1, Number(params.get('page')) || 1);
  const query = { q: deferredFilter, page: pageNo, limit: LIMIT };

  const artists = useQuery({
    queryKey: ['artists', query],
    queryFn: ({ signal }) => api.artists(query, signal),
    placeholderData: keepPreviousData,
  });
  const groups = groupByInitial(artists.data?.items ?? []);

  return (
    <>
      <header className={page.header}>
        <div className={page.headline}>
          <p className="kicker">Index of names</p>
          <h1 className={page.title}>
            {artists.data ? plural(artists.data.total, 'artist') : 'Artists'}
          </h1>
        </div>
        <div className={page.controls}>
          <div className={page.field}>
            <label htmlFor="artist-filter" className="kicker">
              Filter
            </label>
            <input
              id="artist-filter"
              type="search"
              value={filter}
              placeholder="Name contains…"
              maxLength={200}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('q', e.target.value);
                else next.delete('q');
                next.delete('page');
                setParams(next, { replace: true });
              }}
            />
          </div>
        </div>
      </header>

      {groups.length > 1 && (
        <nav aria-label="Jump to letter" className={styles.letters}>
          {groups.map(([letter]) => (
            <a key={letter} href={`#letter-${letter}`}>
              {letter}
            </a>
          ))}
        </nav>
      )}

      {artists.isPending ? (
        <Loading />
      ) : artists.isError ? (
        <ErrorMessage error={artists.error} retry={() => artists.refetch()} />
      ) : groups.length === 0 ? (
        <NoResults>No artists match “{filter}”.</NoResults>
      ) : (
        <div className={styles.index}>
          {groups.map(([letter, list]) => (
            <section
              key={letter}
              id={`letter-${letter}`}
              className={styles.group}
              aria-labelledby={`h-${letter}`}
            >
              <h2 id={`h-${letter}`} className={`display ${styles.letter}`}>
                {letter}
              </h2>
              <ul className={styles.tiles}>
                {list.map((artist) => (
                  <li key={artist.id}>
                    <Link to={`/artists/${artist.id}`} className={styles.tile}>
                      <Mosaic artworkIds={artist.artworkIds} name={artist.name} />
                      <span className={styles.name}>{artist.name}</span>
                      <span className={`mono ${styles.count}`}>
                        {plural(artist.albumCount, 'release')} ·{' '}
                        {plural(artist.trackCount, 'track')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {artists.data && (
        <Pager page={artists.data.page} limit={artists.data.limit} total={artists.data.total} />
      )}
    </>
  );
}

/**
 * Groups by first letter, folding accents ("Ísold" files under I). Letters of
 * other scripts keep their own heading (Д, 坂); digits and symbols go under #.
 */
export function groupByInitial(artists: readonly ArtistSummary[]): [string, ArtistSummary[]][] {
  const groups = new Map<string, ArtistSummary[]>();
  for (const artist of artists) {
    const first = artist.name.trim().normalize('NFKD').replace(/[̀-ͯ]/g, '').charAt(0);
    const letter = /\p{L}/u.test(first) ? first.toLocaleUpperCase() : '#';
    const list = groups.get(letter) ?? [];
    list.push(artist);
    groups.set(letter, list);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b),
  );
}
