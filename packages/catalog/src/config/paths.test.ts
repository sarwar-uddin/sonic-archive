import { describe, expect, it } from 'vitest';
import { isSameOrInside, pathsOverlap } from './path-utils.ts';
import { resolveAppDirs } from './paths.ts';

describe('resolveAppDirs', () => {
  const home = '/home/listener';

  it('defaults to XDG locations under the home directory', () => {
    expect(resolveAppDirs({}, home)).toEqual({
      configDir: '/home/listener/.config/sonic-archive',
      dataDir: '/home/listener/.local/share/sonic-archive',
      cacheDir: '/home/listener/.cache/sonic-archive',
    });
  });

  it('honours XDG_* variables', () => {
    const dirs = resolveAppDirs(
      { XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data', XDG_CACHE_HOME: '/cache' },
      home,
    );
    expect(dirs).toEqual({
      configDir: '/cfg/sonic-archive',
      dataDir: '/data/sonic-archive',
      cacheDir: '/cache/sonic-archive',
    });
  });

  it('lets SONIC_* overrides win and uses them verbatim', () => {
    const dirs = resolveAppDirs(
      { XDG_DATA_HOME: '/data', SONIC_DATA_DIR: '/srv/sonic/data/', SONIC_CACHE_DIR: '/srv/c' },
      home,
    );
    expect(dirs.dataDir).toBe('/srv/sonic/data');
    expect(dirs.cacheDir).toBe('/srv/c');
  });

  it('ignores relative and empty values, as the XDG spec requires', () => {
    const dirs = resolveAppDirs(
      { XDG_CONFIG_HOME: 'relative/cfg', SONIC_DATA_DIR: '', SONIC_CACHE_DIR: './cache' },
      home,
    );
    expect(dirs).toEqual(resolveAppDirs({}, home));
  });
});

describe('isSameOrInside / pathsOverlap', () => {
  it('detects containment and equality', () => {
    expect(isSameOrInside('/music', '/music')).toBe(true);
    expect(isSameOrInside('/music', '/music/Artist/Album')).toBe(true);
    expect(isSameOrInside('/music/Artist', '/music')).toBe(false);
  });

  it('is not fooled by shared string prefixes', () => {
    expect(isSameOrInside('/music', '/music-backup')).toBe(false);
    expect(pathsOverlap('/music', '/music-backup')).toBe(false);
  });

  it('treats a directory named "..foo" as inside', () => {
    expect(isSameOrInside('/music', '/music/..foo')).toBe(true);
  });

  it('is symmetric for overlap', () => {
    expect(pathsOverlap('/a/b', '/a')).toBe(true);
    expect(pathsOverlap('/a', '/a/b')).toBe(true);
  });
});
