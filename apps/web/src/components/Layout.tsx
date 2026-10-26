import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import { formatBytes } from '../lib/format.ts';
import { useLibraryEvents, useLibraryStatus } from '../lib/use-library-events.ts';
import { PlayerProvider, usePlayer } from '../lib/use-player.tsx';
import { SetupPage } from '../pages/SetupPage.tsx';
import { CommandPalette, isTyping } from './CommandPalette.tsx';
import styles from './Layout.module.css';
import { PlayerBar } from './PlayerBar.tsx';

const NAV = [
  { to: '/', label: 'Collection', end: true },
  { to: '/artists', label: 'Artists', end: false },
  { to: '/tracks', label: 'Tracks', end: false },
  { to: '/health', label: 'Health', end: false },
  { to: '/ledger', label: 'Ledger', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Layout() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}

function Shell() {
  const [playerState, player] = usePlayer();
  const notice = useLibraryEvents();
  const library = useLibraryStatus();
  // No music folder yet: every page becomes the setup screen.
  const needsSetup = library.data?.root === null;
  const working = library.data?.state === 'scanning' || library.data?.state === 'analyzing';
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: ({ signal }) => api.stats(signal),
  });
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [palette, setPalette] = useState(false);

  // "/" (outside text fields) or Ctrl/⌘-K opens the search palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const commandK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (commandK || (event.key === '/' && !isTyping(event.target))) {
        event.preventDefault();
        setPalette(true);
      } else if (event.key === ' ' && event.target === document.body) {
        // Space plays and pauses, unless a control or field has focus.
        event.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  // Move focus to the page on navigation so screen readers announce it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change by design
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className={styles.shell} data-player={playerState.queue.length > 0 ? '' : undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.masthead}>
        <div className={styles.bar}>
          <Link to="/" className={styles.wordmark} aria-label="Sonic Archive, home">
            <span className={styles.label} aria-hidden="true" />
            <span className="display">Sonic Archive</span>
          </Link>
          {stats && !needsSetup && (
            <p className={`mono ${styles.plate}`}>
              <span>{stats.tracks.toLocaleString('en')} tracks</span>
              <span>{stats.artists.toLocaleString('en')} artists</span>
              <span>{formatBytes(stats.totalBytes)}</span>
            </p>
          )}
          {!needsSetup && <SearchBox onPalette={() => setPalette(true)} />}
        </div>
        <nav aria-label="Sections" className={styles.nav} hidden={needsSetup}>
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
        {working && library.data && (
          <p className={styles.progress} role="status" aria-label="Library progress">
            <span className={styles.progressBar} aria-hidden="true" />
            {library.data.state === 'scanning'
              ? `Scanning your music… ${library.data.progress?.done ?? 0} files`
              : `Measuring dynamic range… ${library.data.progress?.done ?? 0} of ${library.data.progress?.total ?? '?'} files`}
          </p>
        )}
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        {needsSetup ? <SetupPage /> : <Outlet />}
      </main>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <PlayerBar />
      <p
        className={styles.notice}
        role="status"
        aria-label="Library updates"
        data-shown={notice ? '' : undefined}
      >
        {notice}
      </p>
      <footer className={styles.footer}>
        <p className="kicker">Read-only archive · Nothing leaves this machine</p>
      </footer>
    </div>
  );
}

function SearchBox({ onPalette }: { onPalette: () => void }) {
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
      <button
        type="button"
        className={styles.paletteHint}
        onClick={onPalette}
        aria-label="Open quick search (Ctrl K)"
        title="Quick search: press / or Ctrl K"
      >
        <kbd>/</kbd>
      </button>
    </form>
  );
}
