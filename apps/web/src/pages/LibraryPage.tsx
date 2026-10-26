import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { AlbumGrid } from '../components/AlbumGrid.tsx';
import { Pager } from '../components/Pager.tsx';
import { EmptyLibrary, ErrorMessage, Loading, NoResults } from '../components/States.tsx';
import { api, type Params } from '../lib/api.ts';
import { plural, shortCodec } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './page.module.css';

const LIMIT = 48;

/** Sort menu entries map onto the API's sort + order pair. */
const SORTS = {
  artist: { label: 'Artist', sort: 'artist', order: 'asc' },
  title: { label: 'Title', sort: 'title', order: 'asc' },
  newest: { label: 'Year, newest', sort: 'year', order: 'desc' },
  oldest: { label: 'Year, oldest', sort: 'year', order: 'asc' },
  added: { label: 'Recently added', sort: 'added', order: 'desc' },
} as const;

const RESOLUTIONS = {
  '24bit': { label: '24-bit and above', params: { minBitDepth: 24 } },
  '88k': { label: '88.2 kHz and above', params: { minSampleRate: 88_200 } },
  '176k': { label: '176.4 kHz and above', params: { minSampleRate: 176_400 } },
} as const;

const FILTER_KEYS = ['genre', 'codec', 'res', 'lossless', 'decade'] as const;

export function LibraryPage() {
  useDocumentTitle('Albums');
  const [params, setParams] = useSearchParams();
  const sortKey = (params.get('sort') ?? 'artist') as keyof typeof SORTS;
  const sort = SORTS[sortKey] ?? SORTS.artist;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const decade = Number(params.get('decade')) || undefined;
  const resolution = RESOLUTIONS[params.get('res') as keyof typeof RESOLUTIONS]?.params ?? {};
  const lossless = params.get('lossless');

  const query: Params = {
    sort: sort.sort,
    order: sort.order,
    page,
    limit: LIMIT,
    genreId: params.get('genre'),
    codec: params.get('codec'),
    lossless: lossless === 'yes' ? 'true' : lossless === 'no' ? 'false' : undefined,
    yearFrom: decade,
    yearTo: decade === undefined ? undefined : decade + 9,
    ...resolution,
  };

  const albums = useQuery({
    queryKey: ['albums', query],
    queryFn: ({ signal }) => api.albums(query, signal),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({ queryKey: ['facets'], queryFn: ({ signal }) => api.facets(signal) });
  const stats = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => api.stats(signal) });

  if (stats.data && stats.data.tracks === 0) return <EmptyLibrary />;

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  const filtering = FILTER_KEYS.some((key) => params.has(key));
  const decades = [...new Set((facets.data?.years ?? []).map((y) => Math.floor(y.year / 10) * 10))];

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headline}>
          <p className="kicker">The collection</p>
          <h1 className={styles.title}>
            {albums.data ? plural(albums.data.total, 'album') : 'Albums'}
            {filtering && <em> filtered</em>}
          </h1>
        </div>
        <form
          className={styles.controls}
          aria-label="Sort and filter albums"
          onSubmit={(e) => e.preventDefault()}
        >
          <Select
            label="Sort"
            value={sortKey}
            onChange={(v) => update('sort', v === 'artist' ? '' : v)}
          >
            {Object.entries(SORTS).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            label="Genre"
            value={params.get('genre') ?? ''}
            onChange={(v) => update('genre', v)}
          >
            <option value="">All genres</option>
            {facets.data?.genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.albumCount})
              </option>
            ))}
          </Select>
          <Select
            label="Format"
            value={params.get('codec') ?? ''}
            onChange={(v) => update('codec', v)}
          >
            <option value="">All formats</option>
            {facets.data?.codecs.map((c) => (
              <option key={c.codec} value={c.codec}>
                {shortCodec(c.codec)}
              </option>
            ))}
          </Select>
          <Select
            label="Resolution"
            value={params.get('res') ?? ''}
            onChange={(v) => update('res', v)}
          >
            <option value="">Any resolution</option>
            {Object.entries(RESOLUTIONS).map(([key, r]) => (
              <option key={key} value={key}>
                {r.label}
              </option>
            ))}
          </Select>
          <Select label="Fidelity" value={lossless ?? ''} onChange={(v) => update('lossless', v)}>
            <option value="">Lossless and lossy</option>
            <option value="yes">Lossless only</option>
            <option value="no">Contains lossy</option>
          </Select>
          <Select
            label="Decade"
            value={params.get('decade') ?? ''}
            onChange={(v) => update('decade', v)}
          >
            <option value="">Any decade</option>
            {decades.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </Select>
          {filtering && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                const next = new URLSearchParams(params);
                for (const key of [...FILTER_KEYS, 'page']) next.delete(key);
                setParams(next);
              }}
            >
              Clear filters
            </button>
          )}
        </form>
      </header>

      {albums.isPending ? (
        <Loading label="Pulling records" />
      ) : albums.isError ? (
        <ErrorMessage error={albums.error} retry={() => albums.refetch()} />
      ) : albums.data.items.length === 0 ? (
        <NoResults>No albums match these filters.</NoResults>
      ) : (
        <>
          <AlbumGrid albums={albums.data.items} />
          <Pager page={albums.data.page} limit={albums.data.limit} total={albums.data.total} />
        </>
      )}
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="kicker">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
