export { ConfigError, type ConfigErrorCode } from './config/errors.ts';
export {
  type AppConfig,
  CONFIG_FILE_NAME,
  type LibraryConfig,
  type LoadConfigOptions,
  loadConfig,
} from './config/load-config.ts';
export { isSameOrInside, pathsOverlap } from './config/path-utils.ts';
export { type AppDirs, type Env, resolveAppDirs } from './config/paths.ts';
export { type RootValidationContext, validateLibraryRoot } from './config/validate-root.ts';
export * from './db/catalog-repository.ts';
export {
  type CatalogDatabase,
  type CatalogDb,
  type CatalogExecutor,
  DATABASE_FILE_NAME,
  openCatalogDatabase,
} from './db/database.ts';
export * from './db/library-repository.ts';
export {
  MIGRATIONS_DIR,
  type MigrateOptions,
  type MigrateResult,
  migrateCatalog,
} from './db/migrate.ts';
export * as schema from './db/schema.ts';
export { nameKey } from './text/normalize.ts';
