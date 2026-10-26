import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import styles from './page.module.css';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <section className={styles.headline}>
      <p className="kicker">404</p>
      <h1 className={styles.title}>
        Not in the <em>archive.</em>
      </h1>
      <p>
        <Link to="/">Back to the collection →</Link>
      </p>
    </section>
  );
}

/** Router-level error boundary: a crash in a page shows this instead of a blank screen. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <section className={styles.headline} role="alert">
      <p className="kicker">Something broke</p>
      <h1 className={styles.title}>
        The needle <em>skipped.</em>
      </h1>
      <p>{error instanceof Error ? error.message : 'Unexpected error.'}</p>
      <p>
        <Link to="/">Back to the collection →</Link>
      </p>
    </section>
  );
}
