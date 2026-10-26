import { useQueryClient } from '@tanstack/react-query';
import { FolderPicker } from '../components/FolderPicker.tsx';
import { api } from '../lib/api.ts';
import { useDocumentTitle } from '../lib/use-document-title.ts';
import page from './page.module.css';
import styles from './SetupPage.module.css';

/** First run: no music folder yet. Shown instead of every page until one is chosen. */
export function SetupPage() {
  useDocumentTitle('Welcome');
  const queryClient = useQueryClient();
  return (
    <section className={styles.setup} aria-labelledby="setup-title">
      <header className={page.headline}>
        <p className="kicker">Welcome</p>
        <h1 id="setup-title" className={page.title}>
          Where is your <em>music?</em>
        </h1>
      </header>
      <p className={styles.lede}>
        Choose the folder that holds your music. Sonic Archive reads it to build your catalog and
        keeps watching it for new albums. It never changes, moves or deletes a file, and nothing
        leaves this computer.
      </p>
      <FolderPicker
        onChoose={async (path) => {
          const status = await api.chooseFolder(path);
          queryClient.setQueryData(['library'], status);
          await queryClient.invalidateQueries();
        }}
      />
    </section>
  );
}
