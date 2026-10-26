/**
 * Test helpers for other workspace packages (`@sonic-archive/catalog/testing`).
 * Never imported by application code.
 */
export {
  appendMigration,
  copyMigrations,
  createTempCatalog,
  type TempCatalog,
} from '../db/test-support.ts';
export {
  copyFixtureLibrary,
  FIXTURE_AUDIO_COUNT,
  FIXTURE_LIBRARY,
  type LibraryCopy,
  makeReadOnly,
  makeWritable,
  RUNNING_AS_ROOT,
  snapshotTree,
} from './fixtures.ts';
