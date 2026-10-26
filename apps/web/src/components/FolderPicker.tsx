import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../lib/api.ts';
import styles from './FolderPicker.module.css';

/**
 * Browse to a folder, or paste its path, and choose it. Lists folder names
 * only (the server never sends file names). `onChoose` may reject with a
 * reason ("not a directory", "contains your home folder"), shown here.
 */
export function FolderPicker({
  start,
  onChoose,
  action = 'Use this folder',
}: {
  readonly start?: string | null;
  readonly onChoose: (path: string) => Promise<unknown>;
  readonly action?: string;
}) {
  const [path, setPath] = useState<string | undefined>(start ?? undefined);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listing = useQuery({
    queryKey: ['folders', path ?? '~'],
    queryFn: ({ signal }) => api.folders(path, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const current = listing.data?.path ?? path ?? '';

  const choose = async (folder: string) => {
    setBusy(true);
    setError(null);
    try {
      await onChoose(folder);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) {
      setPath(typed.trim());
      setTyped('');
    }
  };

  return (
    <div className={styles.picker}>
      {listing.data && listing.data.places.length > 0 && (
        <ul className={styles.places} aria-label="Places">
          {listing.data.places.map((p) => (
            <li key={p.path}>
              <button
                type="button"
                onClick={() => setPath(p.path)}
                aria-pressed={p.path === current}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.where}>
        <button
          type="button"
          className={styles.up}
          onClick={() => listing.data?.parent && setPath(listing.data.parent)}
          disabled={!listing.data?.parent}
          aria-label="Up one folder"
        >
          ↑
        </button>
        <p className={`mono ${styles.path}`} aria-live="polite">
          {current}
        </p>
      </div>

      {listing.isError && <p className={styles.error}>{(listing.error as Error).message}</p>}
      <ul className={styles.folders} aria-label="Folders">
        {listing.data?.folders.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setPath(f.path)}>
              <span aria-hidden="true">▸</span> {f.name}
            </button>
          </li>
        ))}
        {listing.data && listing.data.folders.length === 0 && (
          <li className={styles.none}>No folders inside.</li>
        )}
      </ul>

      <form className={styles.typed} onSubmit={go}>
        <label htmlFor="folder-path" className="visually-hidden">
          Folder path
        </label>
        <input
          id="folder-path"
          className="mono"
          placeholder="…or paste a path, e.g. /home/you/Music"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">Go</button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.choose}
        disabled={busy || !listing.data}
        onClick={() => choose(current)}
      >
        {busy ? 'Checking…' : action}
      </button>
    </div>
  );
}
