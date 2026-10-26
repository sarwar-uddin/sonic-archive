import { Link } from 'react-router';
import { useLibraryStatus } from '../lib/use-library-events.ts';
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
 * Shown when the catalog has no tracks: either the first scan is still
 * running, or the chosen folder holds no playable music.
 */
export function EmptyLibrary() {
  const library = useLibraryStatus();
  const scanning = library.data?.state === 'scanning' || library.data?.state === 'analyzing';
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <p className="kicker">The shelves are empty</p>
      {scanning ? (
        <>
          <h1 id="empty-title">Reading your music…</h1>
          <p>Albums appear here as soon as the first scan finishes.</p>
        </>
      ) : (
        <>
          <h1 id="empty-title">No music found yet.</h1>
          <p>
            Nothing playable was found in <code>{library.data?.root ?? 'the music folder'}</code>.
            Check the folder in <Link to="/settings">Settings</Link>, or rescan there after adding
            music.
          </p>
        </>
      )}
      <p className={styles.hint}>
        Sonic Archive only reads your files. Nothing in your music folder is ever changed.
      </p>
    </section>
  );
}

export function NoResults({ children }: { readonly children: React.ReactNode }) {
  return <p className={styles.noResults}>{children}</p>;
}
