import { useQuery } from '@tanstack/react-query';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { formatBytes, formatLongDuration, formatResolution, shortCodec } from '../lib/format.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './LedgerPage.module.css';
import page from './page.module.css';

/** The collection's books: totals, formats, scan history, and library status. */
export function LedgerPage() {
  useDocumentTitle('Ledger');
  const stats = useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => api.stats(signal) });
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal) });
  const scans = useQuery({ queryKey: ['scans'], queryFn: ({ signal }) => api.scans(signal) });

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
        <Figure label="Listening time" value={formatLongDuration(s.durationMs)} />
        <Figure label="On disk" value={formatBytes(s.totalBytes)} />
      </dl>

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
