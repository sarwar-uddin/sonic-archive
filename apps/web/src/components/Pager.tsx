import { Link, useLocation, useSearchParams } from 'react-router';
import styles from '../pages/page.module.css';

/** Previous/next links that keep every other query parameter intact. */
export function Pager({ page, limit, total }: { page: number; limit: number; total: number }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;

  const href = (target: number) => {
    const next = new URLSearchParams(params);
    if (target === 1) next.delete('page');
    else next.set('page', String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav className={styles.pager} aria-label="Pagination">
      {page > 1 ? (
        <Link to={href(page - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span aria-disabled="true">← Previous</span>
      )}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link to={href(page + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span aria-disabled="true">Next →</span>
      )}
    </nav>
  );
}
