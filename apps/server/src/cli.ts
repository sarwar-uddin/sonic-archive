import os from 'node:os';
import {
  ConfigError,
  loadConfig,
  migrateCatalog,
  openCatalogDatabase,
  resolveAppDirs,
} from '@sonic-archive/catalog';

const USAGE = `Usage: sonic-archive <command>

Commands:
  paths     Show where Sonic Archive stores its config, database, and cache
  migrate   Create or upgrade the catalog database (backs up first)`;

const [command] = process.argv.slice(2);

try {
  switch (command) {
    case 'paths': {
      // Deliberately does not load or validate the library root: this command
      // must never touch the music collection.
      const dirs = resolveAppDirs(process.env, os.homedir());
      console.log(`config  ${dirs.configDir}`);
      console.log(`data    ${dirs.dataDir}`);
      console.log(`cache   ${dirs.cacheDir}`);
      break;
    }
    case 'migrate': {
      // Loading the config validates any configured root (realpath + stat of
      // the root only), so an unsafe setup is caught before the DB is created.
      const { dirs } = loadConfig({ env: process.env, homeDir: os.homedir() });
      const database = openCatalogDatabase(dirs.dataDir);
      try {
        const { applied, backupFile } = migrateCatalog(database);
        console.log(`database  ${database.file}`);
        console.log(applied === 0 ? 'up to date' : `applied ${applied} migration(s)`);
        if (backupFile) console.log(`backup    ${backupFile}`);
      } finally {
        database.close();
      }
      break;
    }
    default:
      console.error(USAGE);
      process.exitCode = command === undefined ? 0 : 1;
  }
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuration error (${error.code}): ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
