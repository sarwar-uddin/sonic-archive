import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migrate.ts';
import { findUnreviewedDestructiveStatements, splitStatements } from './migration-guard.ts';

describe('findUnreviewedDestructiveStatements', () => {
  it.each([
    'DROP TABLE `albums`;',
    'drop table if exists albums;',
    'ALTER TABLE `tracks` DROP COLUMN `title`;',
    'ALTER TABLE tracks DROP title;',
    'DELETE FROM files WHERE status = "missing";',
  ])('flags %s', (statement) => {
    expect(findUnreviewedDestructiveStatements([statement])).toEqual([statement]);
  });

  it.each([
    'CREATE TABLE `x` (`id` integer);',
    'DROP INDEX `files_status_idx`;',
    'ALTER TABLE `tracks` ADD `mood` text;',
    "CREATE TABLE notes (body text DEFAULT 'drop it');",
    '-- old note: we used to DROP TABLE here\nCREATE INDEX i ON t (c);',
  ])('allows %s', (statement) => {
    expect(findUnreviewedDestructiveStatements([statement])).toEqual([]);
  });

  it('allows a destructive statement carrying a review marker with a reason', () => {
    const reviewed =
      '-- safety-reviewed: table rebuild; rows copied into __new_tracks above\nDROP TABLE `tracks`;';
    expect(findUnreviewedDestructiveStatements([reviewed])).toEqual([]);
  });

  it('rejects a marker without a reason', () => {
    const lazy = '-- safety-reviewed:\nDROP TABLE `tracks`;';
    expect(findUnreviewedDestructiveStatements([lazy])).toEqual([lazy]);
  });

  it('applies a marker only to its own statement block', () => {
    const migration = splitStatements(
      '-- safety-reviewed: ok\nDROP TABLE a;\n--> statement-breakpoint\nDROP TABLE b;',
    );
    expect(findUnreviewedDestructiveStatements(migration)).toEqual(['\nDROP TABLE b;']);
  });
});

describe('committed migrations', () => {
  const sqlFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('exist', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it.each(sqlFiles)('%s contains no unreviewed destructive SQL', (file) => {
    const statements = splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    expect(findUnreviewedDestructiveStatements(statements)).toEqual([]);
  });
});
