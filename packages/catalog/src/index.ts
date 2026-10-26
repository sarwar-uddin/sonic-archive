export {
  type DynamicRange,
  DynamicRangeMeter,
} from './analysis/dynamic-range.ts';
export { ARTWORK_SUBDIR, storeArtwork } from './cache/artwork-cache.ts';
export { ConfigError, type ConfigErrorCode } from './config/errors.ts';
export {
  type AppConfig,
  type AppSettings,
  CONFIG_FILE_NAME,
  type LibraryConfig,
  type LoadConfigOptions,
  loadConfig,
  rootValidationContext,
  saveConfig,
} from './config/load-config.ts';
export { isSameOrInside, pathsOverlap } from './config/path-utils.ts';
export { type AppDirs, type Env, resolveAppDirs } from './config/paths.ts';
export { assertInsideTestSandbox, isTestRuntime } from './config/sandbox.ts';
export {
  type RootValidationContext,
  validateLibraryRoot,
} from './config/validate-root.ts';
export * from './db/catalog-repository.ts';
export {
  type CatalogDatabase,
  type CatalogDb,
  type CatalogExecutor,
  DATABASE_FILE_NAME,
  type OpenOptions,
  openCatalogDatabase,
} from './db/database.ts';
export {
  type AnalysisJob,
  type DynamicsResult,
  findAnalysisJobs,
  saveDynamics,
} from './db/dynamics-repository.ts';
export * from './db/library-repository.ts';
export {
  MIGRATIONS_DIR,
  type MigrateOptions,
  type MigrateResult,
  migrateCatalog,
} from './db/migrate.ts';
export { resetCatalog } from './db/reset.ts';
export * as schema from './db/schema.ts';
export { rebuildSearchIndex, toFtsQuery } from './db/search-index.ts';
export {
  AUDIO_EXTENSIONS,
  type AudioFileEntry,
  createLibraryReader,
  type LibraryReader,
  type WalkEvent,
  type WalkProblem,
} from './fs/library-reader.ts';
export {
  type PathSafetyCode,
  PathSafetyError,
  resolveInsideRoot,
} from './fs/resolve-inside-root.ts';
export { type CatalogRecord, toCatalogRecord } from './metadata/map.ts';
export { type CatalogQueries, createCatalogQueries } from './read/catalog-queries.ts';
export { buildHealthReport, REPORT_LIMIT } from './read/health-report.ts';
export { type Playback, playbackOf } from './read/playback.ts';
export {
  DEFAULT_MASS_MISSING,
  type ImageCounters,
  type MassMissingThreshold,
  type RenderedImage,
  runScan,
  type ScanOptions,
  type ScanProblem,
  type ScanSummary,
} from './scanner/scan.ts';
export { createDebouncedRunner, type LibraryWatcher, watchLibrary } from './scanner/watch.ts';
export { nameKey } from './text/normalize.ts';
