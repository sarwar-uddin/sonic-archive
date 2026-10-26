import os from 'node:os';
import { resolveAppDirs } from '@sonic-archive/catalog';

const USAGE = `Usage: sonic-archive <command>

Commands:
  paths   Show where Sonic Archive stores its config, database, and cache`;

const [command] = process.argv.slice(2);

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
  default:
    console.error(USAGE);
    process.exitCode = command === undefined ? 0 : 1;
}
