import fs from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import type { CatalogDatabase } from './database.ts';
import { findUnreviewedDestructiveStatements } from './migration-guard.ts';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../drizzle');

/** Drizzle's bookkeeping table; one row per applied migration. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface MigrateOptions {
  readonly migrationsDir?: string;
  /** Where pre-migration backups go. Defaults to `<db dir>/backups`. */
  readonly backupDir?: string;
  readonly now?: () => Date;
}

export interface MigrateResult {
  readonly applied: number;
  /** Snapshot taken before migrating, or null if nothing needed protecting. */
  readonly backupFile: string | null;
}

/**
 * Applies pending migrations. Before changing a database that already holds
 * tables, it writes a consistent snapshot to the backup dir. It refuses to
 * run any migration containing unreviewed destructive SQL.
 */
export function migrateCatalog(
  database: CatalogDatabase,
  options: MigrateOptions = {},
): MigrateResult {
  const migrationsFolder = options.migrationsDir ?? MIGRATIONS_DIR;
  const pending = pendingMigrations(database, readMigrationFiles({ migrationsFolder }));
  if (pending.length === 0) return { applied: 0, backupFile: null };

  for (const migration of pending) {
    const offending = findUnreviewedDestructiveStatements(migration.sql);
    if (offending.length > 0) {
      throw new Error(
        `Refusing to apply migration ${migration.folderMillis}: it contains destructive SQL ` +
          `without a "-- safety-reviewed:" marker:\n${offending.join('\n')}`,
      );
    }
  }

  const backupFile = hasTables(database)
    ? backup(
        database,
        options.backupDir ?? path.join(path.dirname(database.file), 'backups'),
        options.now?.() ?? new Date(),
      )
    : null;

  // Drizzle applies all pending migrations inside one transaction.
  migrate(database.db, { migrationsFolder });
  return { applied: pending.length, backupFile };
}

/** Mirrors drizzle's rule: a migration is pending if newer than the last applied. */
function pendingMigrations(database: CatalogDatabase, all: MigrationMeta[]): MigrationMeta[] {
  const table = database.sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return all;

  const last = database.sqlite
    .prepare(`SELECT max(created_at) AS at FROM ${MIGRATIONS_TABLE}`)
    .get() as { at: number | null };
  return all.filter((m) => last.at === null || m.folderMillis > last.at);
}

function hasTables(database: CatalogDatabase): boolean {
  const row = database.sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { n: number };
  return row.n > 0;
}

function backup(database: CatalogDatabase, dir: string, now: Date): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `sonic-${stamp}-pre-migration.db`);
  // VACUUM INTO writes a consistent, compacted copy, even in WAL mode.
  database.sqlite.prepare('VACUUM INTO ?').run(file);
  return file;
}
