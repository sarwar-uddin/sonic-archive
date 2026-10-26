import type { SearchResults } from '@sonic-archive/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, artworkUrl } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import styles from './CommandPalette.module.css';

/** Pages reachable from the palette by name. */
const PAGES = [
  { label: 'Collection', to: '/' },
  { label: 'Artists', to: '/artists' },
  { label: 'Tracks', to: '/tracks' },
  { label: 'Health', to: '/health' },
  { label: 'Ledger', to: '/ledger' },
];

interface Item {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly detail: string | null;
  readonly to: string;
  readonly artworkId?: number | null;
}

/** Turns search results and the query into one flat, grouped list of choices. */
export function paletteItems(q: string, results: SearchResults | undefined): Item[] {
  const items: Item[] = [];
  const needle = q.trim().toLowerCase();
  for (const page of PAGES) {
    if (needle === '' || page.label.toLowerCase().startsWith(needle)) {
      items.push({
        id: `page-${page.to}`,
        group: 'Page',
        label: page.label,
        detail: null,
        to: page.to,
      });
    }
  }
  if (needle === '' || !results) return items;
  for (const album of results.albums.slice(0, 6)) {
    items.push({
      id: `album-${album.id}`,
      group: 'Album',
      label: album.title,
      detail: [album.albumArtist?.name, album.year].filter(Boolean).join(' · ') || null,
      to: `/albums/${album.id}`,
      artworkId: album.artworkId,
    });
  }
  for (const artist of results.artists.slice(0, 5)) {
    items.push({
      id: `artist-${artist.id}`,
      group: 'Artist',
      label: artist.name,
      detail: plural(artist.albumCount, 'album'),
      to: `/artists/${artist.id}`,
      artworkId: artist.artworkIds[0] ?? null,
    });
  }
  for (const track of results.tracks.slice(0, 8)) {
    if (!track.album) continue;
    items.push({
      id: `track-${track.id}`,
      group: 'Track',
      label: track.title ?? 'Untitled',
      detail: [track.displayArtist, track.album.title].filter(Boolean).join(' — ') || null,
      to: `/albums/${track.album.id}`,
      artworkId: track.album.artworkId,
    });
  }
  items.push({
    id: 'search-all',
    group: 'Search',
    label: `See all results for “${q.trim()}”`,
    detail: null,
    to: `/search?q=${encodeURIComponent(q.trim())}`,
  });
  return items;
}

/**
 * Opens with "/" or Ctrl/⌘-K from anywhere. An accessible combobox: the
 * arrow keys move through the results, Enter opens one, Escape closes.
 */
export function CommandPalette({ onClose }: { readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 120);
    return () => clearTimeout(timer);
  }, [q]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api.search(debounced, signal),
    enabled: debounced !== '',
    placeholderData: keepPreviousData,
  });
  const items = useMemo(
    () => paletteItems(q, debounced === '' ? undefined : results.data),
    [q, debounced, results.data],
  );
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    input.current?.focus();
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, []);

  // Keep the highlighted option in view.
  useEffect(() => {
    document.getElementById(`${listId}-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current, listId]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Search and jump"
      onClose={onClose}
      // Clicking the backdrop closes; Escape is handled by <dialog> itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onKeyDown={() => {}}
    >
      <div className={styles.field}>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items.length > 0 ? `${listId}-${current}` : undefined}
          aria-autocomplete="list"
          aria-label="Search artists, albums, tracks"
          placeholder="Search artists, albums, tracks, or go to a page"
          value={q}
          maxLength={200}
          onChange={(event) => {
            setQ(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current + 1) % Math.max(1, items.length));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current - 1 + items.length) % Math.max(1, items.length));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(items[current]);
            }
          }}
        />
        <kbd className={styles.esc}>Esc</kbd>
      </div>
      <div id={listId} role="listbox" aria-label="Results" className={styles.list}>
        {items.map((item, index) => (
          <div
            key={item.id}
            id={`${listId}-${index}`}
            role="option"
            // Focus stays in the input; options are reached with the arrow keys
            // (aria-activedescendant) and chosen with Enter there.
            tabIndex={-1}
            aria-selected={index === current}
            className={`${styles.option} ${index === current ? styles.active : ''}`}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') choose(item);
            }}
          >
            {item.artworkId !== undefined && (
              <span className={styles.thumb} aria-hidden="true">
                {item.artworkId !== null && <img src={artworkUrl(item.artworkId, 'sm')} alt="" />}
              </span>
            )}
            <span className={styles.text}>
              <span className={styles.label}>{item.label}</span>
              {item.detail && <span className={styles.detail}>{item.detail}</span>}
            </span>
            <span className={`kicker ${styles.group}`}>{item.group}</span>
          </div>
        ))}
        {debounced !== '' && results.isFetching && items.length <= PAGES.length && (
          <p className={styles.status}>Searching…</p>
        )}
      </div>
    </dialog>
  );
}

/** True when the key press belongs to a text field, not to a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}
