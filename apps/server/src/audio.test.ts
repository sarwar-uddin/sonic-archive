import { describe, expect, it } from 'vitest';
import { parseRange, transcodeArgs } from './audio.ts';

describe('parseRange', () => {
  it.each([
    [undefined, 1000, null],
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=500-', 1000, { start: 500, end: 999 }],
    ['bytes=-100', 1000, { start: 900, end: 999 }],
    ['bytes=900-5000', 1000, { start: 900, end: 999 }],
    ['bytes=1000-', 1000, 'invalid'],
    ['bytes=5-2', 1000, 'invalid'],
    ['bytes=-', 1000, 'invalid'],
    ['bytes=0-1,5-9', 1000, 'invalid'],
    ['items=0-1', 1000, 'invalid'],
    ['bytes=0-', 0, 'invalid'],
  ])('%s of %d bytes', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});

describe('transcodeArgs', () => {
  it('reads one local file and writes FLAC only to a pipe', () => {
    const args = transcodeArgs('/music/a b/image.ape', 0, "Monkey's Audio");
    expect(args).toContain('-nostdin');
    expect(
      args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-protocol_whitelist') + 2),
    ).toEqual(['-protocol_whitelist', 'file']);
    // Exactly one input, given as a file: URL so it can never be read as http: etc.
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(args[args.indexOf('-i') + 1]).toBe('file:/music/a b/image.ape');
    // The only output is stdout.
    expect(args.at(-1)).toBe('pipe:1');
    expect(args.slice(-3)).toEqual(['-f', 'flac', 'pipe:1']);
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-y');
  });

  it('starts at an offset for seeking, and resamples DSD', () => {
    expect(transcodeArgs('/m/a.ape', 61.5, null)).toEqual(
      expect.arrayContaining(['-ss', '61.500']),
    );
    expect(transcodeArgs('/m/a.dsf', 0, 'DSD')).toEqual(
      expect.arrayContaining(['-af', 'aresample=88200', '-sample_fmt', 's32']),
    );
  });
});
