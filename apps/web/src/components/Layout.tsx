import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import styles from './Layout.module.css';

const NAV = [
  { to: '/', label: 'Albums', end: true },
  { to: '/artists', label: 'Artists', end: false },
  { to: '/tracks', label: 'Tracks', end: false },
  { to: '/ledger', label: 'Ledger', end: false },
];

export function Layout() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: ({ signal }) => api.stats(signal),
  });
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so screen readers announce it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change by design
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.masthead}>
        <div className={styles.top}>
          <Link to="/" className={styles.wordmark} aria-label="Sonic Archive, home">
            Sonic <em>Archive</em>
          </Link>
          <p className={`kicker ${styles.edition}`}>
            {stats
              ? `${plural(stats.albums, 'album')} · ${plural(stats.tracks, 'track')}`
              : 'A private collection'}
          </p>
          <SearchBox />
        </div>
        <nav aria-label="Sections" className={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p className="kicker">Read-only · Local · Yours</p>
      </footer>
    </div>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const current = location.pathname === '/search' ? (params.get('q') ?? '') : '';

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = current;
  }, [current]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get('q')?.toString().trim() ?? '';
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="search" on a form is well supported; <search> is too new
    <form role="search" className={styles.search} onSubmit={onSubmit}>
      <label htmlFor="global-search" className="visually-hidden">
        Search the collection
      </label>
      <input
        ref={inputRef}
        id="global-search"
        name="q"
        type="search"
        placeholder="Search artists, albums, tracks"
        defaultValue={current}
        autoComplete="off"
        maxLength={200}
      />
    </form>
  );
}
