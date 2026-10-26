import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FolderPicker } from '../components/FolderPicker.tsx';
import { ErrorMessage, Loading } from '../components/States.tsx';
import { api } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import { useLibraryStatus } from '../lib/use-library-events.ts';
import page from './page.module.css';
import styles from './SettingsPage.module.css';

/** The music folder, how it is kept up to date, and rescans. */
export function SettingsPage() {
  useDocumentTitle('Settings');
  const queryClient = useQueryClient();
  const status = useLibraryStatus();
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (status.isPending) return <Loading />;
  if (status.isError) return <ErrorMessage error={status.error} retry={() => status.refetch()} />;
  const s = status.data;
  const update = async (request: Promise<typeof s>) => {
    setProblem(null);
    try {
      queryClient.setQueryData(['library'], await request);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const busy = s.state === 'scanning' || s.state === 'analyzing';

  return (
    <>
      <header className={page.header}>
        <div className={page.headline}>
          <p className="kicker">Settings</p>
          <h1 className={page.title}>
            Your <em>library.</em>
          </h1>
        </div>
      </header>

      <section className={page.section} aria-labelledby="folder-h">
        <h2 id="folder-h" className={page.sectionTitle}>
          Music folder
        </h2>
        <p className={`mono ${styles.folder}`}>{s.root}</p>
        {s.source === 'env' ? (
          <p className={styles.note}>
            Set by the <code>SONIC_LIBRARY_ROOT</code> environment variable, so it cannot be changed
            here.
          </p>
        ) : changing ? (
          <div className={styles.change}>
            <p className={styles.note}>
              Switching folders rebuilds the catalog from the new folder (it takes a while for a
              large collection). Your music files are never changed.
            </p>
            <FolderPicker
              start={s.root}
              action="Switch to this folder"
              onChoose={async (path) => {
                const next = await api.chooseFolder(path);
                queryClient.setQueryData(['library'], next);
                await queryClient.invalidateQueries();
                setChanging(false);
              }}
            />
            <button type="button" className={styles.button} onClick={() => setChanging(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={styles.button} onClick={() => setChanging(true)}>
            Change folder…
          </button>
        )}
      </section>

      <section className={page.section} aria-labelledby="updates-h">
        <h2 id="updates-h" className={page.sectionTitle}>
          Keeping up to date
        </h2>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={s.watching}
            onChange={(e) => update(api.setWatching(e.target.checked))}
          />
          <span>
            Watch the folder for changes
            <span className={styles.note}>
              New, changed and removed files are picked up within seconds. Off: the folder is
              scanned when the app starts and when you rescan.
            </span>
          </span>
        </label>
        <p className={styles.state} role="status">
          {s.state === 'scanning'
            ? `Scanning… ${s.progress?.done ?? 0} files`
            : s.state === 'analyzing'
              ? `Measuring dynamic range… ${s.progress?.done ?? 0} of ${s.progress?.total ?? '?'} files`
              : 'Up to date.'}
        </p>
        {s.error && <p className={styles.problem}>Last scan: {s.error}</p>}
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
        <p className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => update(api.rescan(false))}
          >
            Rescan now
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => update(api.rescan(true))}
          >
            Re-read every file
          </button>
        </p>
        <p className={styles.note}>
          A rescan only reads new or changed files. Re-reading every file is slower; use it after
          editing tags in a way that keeps file dates.
        </p>
      </section>
    </>
  );
}
