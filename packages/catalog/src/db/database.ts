import fs from 'node:fs';
import path from 'node:path';
import type { RunResult } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';

export type CatalogDb = BetterSQLite3Database<typeof schema>;

/** Either the database or an open transaction; repositories accept both. */
export type CatalogExecutor = BaseSQLiteDatabase<'sync', RunResult, typeof schema>;

export interface CatalogDatabase {
  readonly db: CatalogDb;
  readonly sqlite: Database.Database;
  readonly file: string;
  close(): void;
}

export const DATABASE_FILE_NAME = 'sonic.db';

/**
 * Opens (creating if needed) the catalog database inside the app's data dir.
 * The data dir has already been checked not to overlap the music library
 * (`validateLibraryRoot`).
 */
export function openCatalogDatabase(dataDir: string): CatalogDatabase {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, DATABASE_FILE_NAME);
  const sqlite = new Database(file);

  // WAL lets the API read while a scan writes; NORMAL sync is safe under WAL.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  // SQLite leaves foreign keys off unless asked, per connection.
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    file,
    close: () => sqlite.close(),
  };
}
