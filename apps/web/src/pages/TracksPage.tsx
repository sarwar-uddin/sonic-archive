import type { TrackListItem } from '@sonic-archive/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { type FormEvent, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorMessage, Loading, NoResults } from '../components/States.tsx';
import { api, type Params } from '../lib/api.ts';
import { formatDuration, formatResolution, isHiRes, plural, shortCodec } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import page from './page.module.css';
import styles from './TracksPage.module.css';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 44;

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'sampleRate', label: 'Format' },
  { key: 'duration', label: 'Time' },
] as const;

type SortKey = (typeof COLUMNS)[number]['key'];

export function TracksPage() {
  useDocumentTitle('Tracks');
  const [params, setParams] = useSearchParams();
  const sort = (params.get('sort') ?? 'artist') as SortKey;
  const order = params.get('order') === 'desc' ? 'desc' : 'asc';
  const filters: Params = {
    q: params.get('q'),
    codec: params.get('codec'),
    bitDepth: params.get('bits'),
    minSampleRate: params.get('rate'),
    sort,
    order,
    limit: PAGE_SIZE,
  };

  const facets = useQuery({ queryKey: ['facets'], queryFn: ({ signal }) => api.facets(signal) });
  const tracks = useInfiniteQuery({
    queryKey: ['tracks', filters],
    queryFn: ({ pageParam, signal }) => api.tracks({ ...filters, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
  const rows = tracks.data?.pages.flatMap((p) => p.items) ?? [];
  const total = tracks.data?.pages[0]?.total ?? 0;

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ q: new FormData(event.currentTarget).get('q')?.toString().trim() ?? null });
  };

  return (
    <>
      <header className={page.header}>
        <div className={page.headline}>
          <p className="kicker">Every recording</p>
          <h1 className={page.title}>{tracks.data ? plural(total, 'track') : 'Tracks'}</h1>
        </div>
        <form className={page.controls} onSubmit={onSearch} aria-label="Filter tracks">
          <div className={page.field}>
            <label htmlFor="track-q" className="kicker">
              Contains
            </label>
            <input
              id="track-q"
              name="q"
              type="search"
              defaultValue={params.get('q') ?? ''}
              maxLength={200}
            />
          </div>
          <div className={page.field}>
            <label htmlFor="track-codec" className="kicker">
              Format
            </label>
            <select
              id="track-codec"
              value={params.get('codec') ?? ''}
              onChange={(e) => update({ codec: e.target.value })}
            >
              <option value="">All</option>
              {facets.data?.codecs.map((c) => (
                <option key={c.codec} value={c.codec}>
                  {shortCodec(c.codec)} ({c.trackCount})
                </option>
              ))}
            </select>
          </div>
          <div className={page.field}>
            <label htmlFor="track-bits" className="kicker">
              Bit depth
            </label>
            <select
              id="track-bits"
              value={params.get('bits') ?? ''}
              onChange={(e) => update({ bits: e.target.value })}
            >
              <option value="">Any</option>
              {facets.data?.bitDepths.map((b) => (
                <option key={b.bitDepth} value={b.bitDepth}>
                  {b.bitDepth}-bit ({b.trackCount})
                </option>
              ))}
            </select>
          </div>
          <div className={page.field}>
            <label htmlFor="track-rate" className="kicker">
              Sample rate
            </label>
            <select
              id="track-rate"
              value={params.get('rate') ?? ''}
              onChange={(e) => update({ rate: e.target.value })}
            >
              <option value="">Any</option>
              {facets.data?.sampleRates.map((r) => (
                <option key={r.sampleRate} value={r.sampleRate}>
                  ≥ {formatResolution(null, r.sampleRate)}
                </option>
              ))}
            </select>
          </div>
        </form>
      </header>

      {tracks.isPending ? (
        <Loading />
      ) : tracks.isError ? (
        <ErrorMessage error={tracks.error} retry={() => tracks.refetch()} />
      ) : rows.length === 0 ? (
        <NoResults>No tracks match.</NoResults>
      ) : (
        <TrackTable
          rows={rows}
          total={total}
          sort={sort}
          order={order}
          onSort={(key) =>
            update({
              sort: key === 'artist' ? null : key,
              order: key === sort && order === 'asc' ? 'desc' : null,
            })
          }
          loadMore={() => {
            if (tracks.hasNextPage && !tracks.isFetchingNextPage) void tracks.fetchNextPage();
          }}
        />
      )}
    </>
  );
}

interface TrackTableProps {
  rows: readonly TrackListItem[];
  total: number;
  sort: SortKey;
  order: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  loadMore: () => void;
}

/**
 * A virtualized table: only rows near the viewport exist in the DOM, so a
 * 50k-track library scrolls as smoothly as a 50-track one. More pages are
 * fetched as the end of the loaded rows comes into view.
 */
function TrackTable({ rows, total, sort, order, onSort, loadMore }: TrackTableProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: bodyRef.current?.offsetTop ?? 0,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (lastIndex >= rows.length - 20 && rows.length < total) loadMore();
  }, [lastIndex, rows.length, total, loadMore]);

  // A real <table>, laid out with CSS grid so rows can be absolutely
  // positioned by the virtualizer. aria-rowcount/rowindex tell assistive
  // technology about the rows that are not currently rendered.
  return (
    <table className={styles.table} aria-label="Tracks" aria-rowcount={total + 1}>
      <thead className={styles.thead}>
        <tr className={styles.row} aria-rowindex={1}>
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              scope="col"
              aria-sort={sort === col.key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={col.key === 'duration' ? styles.alignEnd : undefined}
            >
              <button type="button" onClick={() => onSort(col.key)}>
                {col.label}
                {sort === col.key && (
                  <span aria-hidden="true">{order === 'asc' ? ' ↑' : ' ↓'}</span>
                )}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody ref={bodyRef} className={styles.body} style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const track = rows[item.index];
          if (!track) return null;
          return (
            <tr
              key={track.id}
              aria-rowindex={item.index + 2}
              className={styles.row}
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <td className={styles.title}>
                {track.title ?? (
                  <span className={styles.dim}>{track.file.relPath.split('/').at(-1)}</span>
                )}
              </td>
              <td className={styles.artist}>{track.displayArtist ?? '—'}</td>
              <td className={styles.album}>
                {track.album ? (
                  <Link to={`/albums/${track.album.id}`}>{track.album.title}</Link>
                ) : (
                  '—'
                )}
              </td>
              <td className={`mono ${styles.year}`}>{track.year ?? '—'}</td>
              <td
                className={`mono ${styles.sampleRate} ${isHiRes(track.bitDepth, track.sampleRate) ? styles.hiRes : ''}`}
              >
                {shortCodec(track.codec)} {formatResolution(track.bitDepth, track.sampleRate)}
              </td>
              <td className={`mono ${styles.duration}`}>{formatDuration(track.durationMs)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
