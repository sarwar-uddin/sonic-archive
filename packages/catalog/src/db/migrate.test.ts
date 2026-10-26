import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CatalogDatabase, DATABASE_FILE_NAME, openCatalogDatabase } from './database.ts';
import { migrateCatalog } from './migrate.ts';
import { appendMigration, copyMigrations } from './test-support.ts';

let dir: string;
let database: CatalogDatabase;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonic-migrate-'));
  database = openCatalogDatabase(path.join(dir, 'data'));
});

afterEach(() => {
  database.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

describe('openCatalogDatabase', () => {
  it('creates the database file inside the data dir with safe pragmas', () => {
    expect(database.file).toBe(path.join(dir, 'data', DATABASE_FILE_NAME));
    expect(fs.existsSync(database.file)).toBe(true);
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('openCatalogDatabase (read-only)', () => {
  it('refuses every write', () => {
    migrateCatalog(database);
    const readonly = openCatalogDatabase(path.join(dir, 'data'), { readonly: true });
    try {
      expect(() =>
        readonly.sqlite.prepare("INSERT INTO library_roots (path) VALUES ('/x')").run(),
      ).toThrow(/readonly|read-only|query_only/i);
      expect(() => readonly.sqlite.exec('DROP TABLE albums')).toThrow();
      expect(readonly.sqlite.prepare('SELECT count(*) AS n FROM albums').get()).toEqual({ n: 0 });
    } finally {
      readonly.close();
    }
  });

  it('does not create a missing database', () => {
    expect(() => openCatalogDatabase(path.join(dir, 'nowhere'), { readonly: true })).toThrow();
    expect(fs.existsSync(path.join(dir, 'nowhere'))).toBe(false);
  });
});

describe('migrateCatalog', () => {
  it('creates the schema on a fresh database without a pointless backup', () => {
    const result = migrateCatalog(database);
    expect(result).toEqual({ applied: 3, backupFile: null });
    expect(tableNames(database.sqlite)).toEqual([
      'albums',
      'artists',
      'artwork',
      'files',
      'genres',
      'library_roots',
      'scans',
      'track_artists',
      'track_genres',
      'track_search', // FTS5 virtual table (0001) and its shadow tables:
      'track_search_config',
      'track_search_content',
      'track_search_data',
      'track_search_docsize',
      'track_search_idx',
      'tracks',
    ]);
  });

  it('is idempotent', () => {
    migrateCatalog(database);
    expect(migrateCatalog(database)).toEqual({ applied: 0, backupFile: null });
  });

  it('backs up an existing database before applying new migrations', () => {
    const migrations = copyMigrations(path.join(dir, 'migrations'));
    migrateCatalog(database, { migrationsDir: migrations });
    database.sqlite.prepare("INSERT INTO library_roots (path) VALUES ('/music')").run();

    appendMigration(migrations, '0001_add_mood', 'ALTER TABLE `tracks` ADD `mood` text;');
    const result = migrateCatalog(database, {
      migrationsDir: migrations,
      now: () => new Date('2026-10-26T12:00:00.000Z'),
    });

    expect(result.applied).toBe(1);
    expect(result.backupFile).toBe(
      path.join(dir, 'data', 'backups', 'sonic-2026-10-26T12-00-00-000Z-pre-migration.db'),
    );
    const snapshot = new Database(result.backupFile ?? '', { readonly: true });
    try {
      // The snapshot holds the data, from before the new column existed.
      expect(snapshot.prepare('SELECT path FROM library_roots').all()).toEqual([
        { path: '/music' },
      ]);
      const columns = snapshot.pragma('table_info(tracks)') as { name: string }[];
      expect(columns.map((c) => c.name)).not.toContain('mood');
    } finally {
      snapshot.close();
    }
  });

  it('refuses unreviewed destructive migrations and leaves the database untouched', () => {
    const migrations = copyMigrations(path.join(dir, 'migrations'));
    migrateCatalog(database, { migrationsDir: migrations });
    database.sqlite.prepare("INSERT INTO library_roots (path) VALUES ('/music')").run();

    appendMigration(migrations, '0001_oops', 'DROP TABLE `library_roots`;');
    expect(() => migrateCatalog(database, { migrationsDir: migrations })).toThrow(
      /Refusing to apply migration/,
    );

    expect(database.sqlite.prepare('SELECT count(*) AS n FROM library_roots').get()).toEqual({
      n: 1,
    });
    expect(fs.existsSync(path.join(dir, 'data', 'backups'))).toBe(false);
  });

  it('rolls back every pending migration if one fails', () => {
    const migrations = copyMigrations(path.join(dir, 'migrations'));
    migrateCatalog(database, { migrationsDir: migrations });
    appendMigration(migrations, '0001_ok', 'ALTER TABLE `tracks` ADD `mood` text;');
    appendMigration(migrations, '0002_broken', 'ALTER TABLE `no_such_table` ADD `x` text;');

    expect(() => migrateCatalog(database, { migrationsDir: migrations })).toThrow();
    const columns = database.sqlite.pragma('table_info(tracks)') as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('mood');
  });
});

describe('schema constraints', () => {
  beforeEach(() => {
    migrateCatalog(database);
    database.sqlite.prepare("INSERT INTO library_roots (path) VALUES ('/music')").run();
  });

  it('rejects unknown status values', () => {
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO scans (root_id, started_at, status, mode) VALUES (1, 0, 'paused', 'full')",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO scans (root_id, started_at, status, mode) VALUES (999, 0, 'running', 'full')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('fills created_at with whole milliseconds', () => {
    const row = database.sqlite.prepare('SELECT created_at FROM library_roots').get() as {
      created_at: number;
    };
    expect(Number.isInteger(row.created_at)).toBe(true);
    expect(Math.abs(row.created_at - Date.now())).toBeLessThan(60_000);
  });
});
