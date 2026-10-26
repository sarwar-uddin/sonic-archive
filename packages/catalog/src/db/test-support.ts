import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type CatalogDatabase, openCatalogDatabase } from './database.ts';
import { MIGRATIONS_DIR, migrateCatalog } from './migrate.ts';

export interface TempCatalog {
  readonly database: CatalogDatabase;
  readonly dataDir: string;
  cleanup(): void;
}

/** A migrated catalog in a fresh temp dir. Test-only; not exported by the package. */
export function createTempCatalog(): TempCatalog {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-db-'));
  const database = openCatalogDatabase(dataDir);
  migrateCatalog(database);
  return {
    database,
    dataDir,
    cleanup() {
      database.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Copies the real migrations so a test can append a planted one. */
export function copyMigrations(targetDir: string): string {
  fs.cpSync(MIGRATIONS_DIR, targetDir, { recursive: true });
  return targetDir;
}

export function appendMigration(migrationsDir: string, tag: string, sqlText: string): void {
  const journalFile = path.join(migrationsDir, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as {
    entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[];
  };
  const last = journal.entries.at(-1);
  journal.entries.push({
    idx: journal.entries.length,
    version: last?.version ?? '6',
    when: (last?.when ?? 0) + 1000,
    tag,
    breakpoints: true,
  });
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  fs.writeFileSync(path.join(migrationsDir, `${tag}.sql`), sqlText);
}
