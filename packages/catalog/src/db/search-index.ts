import { sql } from 'drizzle-orm';
import type { CatalogExecutor } from './database.ts';

/**
 * Rebuilds the `track_search` FTS5 index from the catalog. The index is
 * derived data (see drizzle/0001_search_index.sql), so a full rebuild is the
 * simplest correct maintenance: it takes about a second for 50k tracks and
 * runs only after a scan that changed something.
 */
export function rebuildSearchIndex(db: CatalogExecutor): void {
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM track_search`);
    tx.run(sql`
      INSERT INTO track_search (rowid, title, artist, album, genre)
      SELECT
        t.id,
        coalesce(t.title, ''),
        trim(
          coalesce(t.display_artist, '') || ' ' ||
          coalesce((SELECT group_concat(ar.name, ' ') FROM track_artists ta
                    JOIN artists ar ON ar.id = ta.artist_id WHERE ta.track_id = t.id), '') || ' ' ||
          coalesce(aa.name, '')
        ),
        coalesce(a.title, ''),
        coalesce((SELECT group_concat(g.name, ' ') FROM track_genres tg
                  JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id), '')
      FROM tracks t
      LEFT JOIN albums a ON a.id = t.album_id
      LEFT JOIN artists aa ON aa.id = a.album_artist_id
    `);
  });
}

const MAX_TERMS = 8;

/**
 * Turns free text into a safe FTS5 query: every run of letters/digits
 * becomes a quoted prefix term, all of which must match. Anything else
 * (quotes, `*`, `NEAR`, `-`, parentheses) is dropped, so user input can never
 * be interpreted as FTS5 syntax. Returns null when nothing searchable remains.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms
    .slice(0, MAX_TERMS)
    .map((term) => `"${term}"*`)
    .join(' ');
}
