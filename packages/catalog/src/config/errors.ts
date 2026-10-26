export type ConfigErrorCode =
  | 'INVALID_CONFIG_FILE'
  | 'ROOT_NOT_ABSOLUTE'
  | 'ROOT_INVALID_CHARACTERS'
  | 'ROOT_IS_FILESYSTEM_ROOT'
  | 'ROOT_IS_HOME_OR_ANCESTOR'
  | 'ROOT_NOT_FOUND'
  | 'ROOT_NOT_DIRECTORY'
  | 'ROOT_OVERLAPS_APP_DIR'
  | 'ROOT_OUTSIDE_TEST_SANDBOX';

/**
 * Raised when configuration is unsafe or unusable. The application refuses
 * to start rather than guessing: failing closed is the safe default.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}
