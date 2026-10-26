import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import styles from './States.module.css';

export function Loading({ label = 'Loading' }: { readonly label?: string }) {
  return (
    <p className={styles.loading} role="status">
      <span className={styles.groove} aria-hidden="true" />
      {label}…
    </p>
  );
}

export function ErrorMessage({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry?: () => void;
}) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className={styles.error} role="alert">
      <p className="kicker">Could not load</p>
      <p>{message}</p>
      <p className={styles.hint}>
        Is the API running? Start it with <code>pnpm dev</code>.
      </p>
      {retry && (
        <button type="button" className={styles.button} onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Shown when the catalog has no tracks: explains how to point the app at a
 * library and run a first, scoped scan.
 */
export function EmptyLibrary() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
  });
  const configured = health?.library.configured ?? false;
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <p className="kicker">The shelves are empty</p>
      <h1 id="empty-title">Nothing catalogued yet.</h1>
      {configured ? (
        <p>
          A library is configured but has not been scanned. Run a sample scan of one folder first:
        </p>
      ) : (
        <p>
          Point Sonic Archive at your music in <code>~/.config/sonic-archive/config.json</code>,
          then run a sample scan of one folder:
        </p>
      )}
      <pre className={styles.code}>
        {configured ? '' : '{ "libraryRoot": "/absolute/path/to/Music" }\n\n'}
        pnpm scan --confirm --subpath "Artist/Album"
      </pre>
      <p className={styles.hint}>
        Scans only read your files. Nothing in the library is ever changed.
      </p>
    </section>
  );
}

export function NoResults({ children }: { readonly children: React.ReactNode }) {
  return <p className={styles.noResults}>{children}</p>;
}
