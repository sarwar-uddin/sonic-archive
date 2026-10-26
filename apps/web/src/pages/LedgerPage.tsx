import type { RipVerdict, Statistics } from '@sonic-archive/contracts';
import { useQuery } from '@tanstack/react-query';
import { BarList, ColumnChart, StackedBar } from '../components/Charts.tsx';
import { VERDICT_LABELS } from '../components/RipLogs.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { formatBytes, formatResolution, shortCodec } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './LedgerPage.module.css';
import page from './page.module.css';

/** The collection's books: totals, formats, scan history, and library status. */
export function LedgerPage() {
  useDocumentTitle('Ledger');
  const stats = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => api.stats(signal) });
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal) });
  const scans = useQuery({ queryKey: ['scans'], queryFn: ({ signal }) => api.scans(signal) });
  const statistics = useQuery({
    queryKey: ['statistics'],
    queryFn: ({ signal }) => api.statistics(signal),
  });

  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorMessage error={stats.error} retry={() => stats.refetch()} />;
  const s = stats.data;

  return (
    <>
      <header className={page.header}>
        <div className={page.headline}>
          <p className="kicker">The ledger</p>
          <h1 className={page.title}>
            The collection, <em>by the numbers.</em>
          </h1>
        </div>
      </header>

      <dl className={styles.figures}>
        <Figure label="Albums" value={s.albums.toLocaleString('en')} />
        <Figure label="Artists" value={s.artists.toLocaleString('en')} />
        <Figure label="Tracks" value={s.tracks.toLocaleString('en')} />
        <Figure label="Listening time" value={compactDuration(s.durationMs)} />
        <Figure label="On disk" value={formatBytes(s.totalBytes)} />
      </dl>

      {statistics.data && <Charts data={statistics.data} />}

      <section className={page.section} aria-labelledby="formats">
        <h2 id="formats" className={page.sectionTitle}>
          Formats
        </h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Codec</th>
              <th scope="col">Resolution</th>
              <th scope="col" className={styles.num}>
                Tracks
              </th>
              <th scope="col" className={styles.num}>
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {s.formats.map((f) => (
              <tr key={`${f.codec}-${f.sampleRate}-${f.bitDepth}`}>
                <td>{shortCodec(f.codec)}</td>
                <td className="mono">{formatResolution(f.bitDepth, f.sampleRate)}</td>
                <td className={`mono ${styles.num}`}>{f.trackCount.toLocaleString('en')}</td>
                <td className={`mono ${styles.num}`}>
                  {s.tracks ? `${((f.trackCount / s.tracks) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={page.section} aria-labelledby="status">
        <h2 id="status" className={page.sectionTitle}>
          Library status
        </h2>
        <dl className={styles.status}>
          <dt>Library</dt>
          <dd>
            {health.data
              ? health.data.library.configured
                ? health.data.library.available
                  ? 'Configured and reachable'
                  : 'Configured but not reachable'
                : 'Not configured'
              : '…'}
          </dd>
          <dt>Missing files</dt>
          <dd className={s.missingFiles ? styles.warn : ''}>
            {s.missingFiles.toLocaleString('en')}
          </dd>
          <dt>Unreadable files</dt>
          <dd className={s.errorFiles ? styles.warn : ''}>{s.errorFiles.toLocaleString('en')}</dd>
        </dl>
      </section>

      <section className={page.section} aria-labelledby="scans">
        <h2 id="scans" className={page.sectionTitle}>
          Scan history
        </h2>
        {scans.data && scans.data.length > 0 ? (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Started</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Result</th>
                  <th scope="col" className={styles.num}>
                    Seen
                  </th>
                  <th scope="col" className={styles.num}>
                    Added
                  </th>
                  <th scope="col" className={styles.num}>
                    Updated
                  </th>
                  <th scope="col" className={styles.num}>
                    Missing
                  </th>
                  <th scope="col" className={styles.num}>
                    Errors
                  </th>
                </tr>
              </thead>
              <tbody>
                {scans.data.map((scan) => (
                  <tr key={scan.id}>
                    <td className="mono">{scan.id}</td>
                    <td className="mono">{new Date(scan.startedAt).toLocaleString()}</td>
                    <td className={styles.scope}>{scan.scopeSubpath ?? 'Entire library'}</td>
                    <td title={scan.errorMessage ?? undefined}>
                      {scan.status}
                      {scan.mode === 'full' ? ' · full' : ''}
                    </td>
                    <td className={`mono ${styles.num}`}>{scan.seen}</td>
                    <td className={`mono ${styles.num}`}>{scan.added}</td>
                    <td className={`mono ${styles.num}`}>{scan.updated}</td>
                    <td className={`mono ${styles.num}`}>{scan.missing}</td>
                    <td className={`mono ${styles.num}`}>{scan.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.note}>No scans yet.</p>
        )}
      </section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <dt className="kicker">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const RIP_COLORS: Record<RipVerdict | 'none', string> = {
  verified: 'var(--verified)',
  clean: 'var(--paper-dim)',
  differs: 'var(--warn)',
  problems: 'var(--accent)',
  unknown: 'var(--muted)',
  none: 'var(--status-none)',
};

const RELEASES: [string, string] = ['release', 'releases'];

/** The shape of the collection, over its releases. */
function Charts({ data }: { data: Statistics }) {
  return (
    <>
      <section className={page.section} aria-labelledby="decades">
        <h2 id="decades" className={page.sectionTitle}>
          Releases by decade
        </h2>
        <p className={styles.note}>
          {data.releases.toLocaleString('en')} releases by album year
          {data.undated > 0 ? `; ${data.undated} without a year are left out` : ''}.
        </p>
        <ColumnChart
          label="Releases by decade"
          unit={RELEASES}
          columns={data.decades.map((d) => ({
            key: String(d.decade),
            label: `${d.decade}s`,
            value: d.releases,
          }))}
        />
      </section>

      <div className={styles.chartGrid}>
        <section className={page.section} aria-labelledby="origins">
          <h2 id="origins" className={page.sectionTitle}>
            Pressed in
          </h2>
          <p className={styles.note}>Countries named in the pressing details of folder names.</p>
          {data.origins.length > 0 ? (
            <BarList
              label="Releases by country of pressing"
              unit={RELEASES}
              total={data.releases}
              rows={data.origins.map((o) => ({
                key: o.country,
                label: o.country,
                value: o.releases,
              }))}
            />
          ) : (
            <p className={styles.note}>No folder names mention a country.</p>
          )}
        </section>

        <section className={page.section} aria-labelledby="rips">
          <h2 id="rips" className={page.sectionTitle}>
            Rip verification
          </h2>
          <p className={styles.note}>What the EAC, XLD and CUETools logs say about each release.</p>
          <StackedBar
            label="Releases by rip verdict"
            unit={RELEASES}
            segments={data.rips.map((r) => ({
              key: r.verdict,
              label: r.verdict === 'none' ? 'No rip log' : VERDICT_LABELS[r.verdict],
              value: r.releases,
              color: RIP_COLORS[r.verdict],
            }))}
          />
        </section>

        <section className={page.section} aria-labelledby="genres">
          <h2 id="genres" className={page.sectionTitle}>
            Genres
          </h2>
          <BarList
            label="Releases by genre"
            unit={RELEASES}
            total={data.releases}
            rows={data.genres.map((g) => ({
              key: String(g.id),
              label: g.name,
              value: g.releases,
              to: `/?genre=${g.id}`,
            }))}
          />
        </section>

        <section className={page.section} aria-labelledby="most-collected">
          <h2 id="most-collected" className={page.sectionTitle}>
            Most collected
          </h2>
          <BarList
            label="Releases by artist"
            unit={RELEASES}
            total={data.releases}
            rows={data.artists.map((a) => ({
              key: String(a.id),
              label: a.name,
              value: a.releases,
              to: `/artists/${a.id}`,
            }))}
          />
        </section>
      </div>
    </>
  );
}

/** "6d 3h", "14h 20m": short enough for a headline figure. */
export function compactDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}
