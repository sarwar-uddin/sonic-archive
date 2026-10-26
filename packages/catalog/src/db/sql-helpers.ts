import { type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** `excluded.<col>`: the value an upsert tried to insert. */
export function excluded(column: SQLiteColumn): SQL {
  return sql.raw(`excluded."${column.name}"`);
}
