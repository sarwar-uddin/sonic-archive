import { sql } from 'drizzle-orm';
import type { CatalogExecutor } from './database.ts';

/**
 * Empties the catalog before indexing a different music folder. Everything
 * here is derived from the old folder and would be rebuilt by scanning it
 * again; nothing in any music folder is touched. Artwork rows stay: the
 * cache is content-addressed and covers shared by the next folder are reused.
 */
export function resetCatalog(db: CatalogExecutor): void {
  db.transaction((tx) => {
    for (const table of [
      'track_dynamics',
      'track_artists',
      'track_genres',
      'album_images',
      'rip_logs',
      'tracks',
      'albums',
      'artists',
      'genres',
      'files',
      'scans',
      'library_roots',
      'track_search',
    ]) {
      tx.run(sql.raw(`DELETE FROM ${table}`));
    }
  });
}
