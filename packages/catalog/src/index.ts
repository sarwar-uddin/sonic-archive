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
