/**
 * Streaming audio for playback.
 *
 * Files browsers can decode are sent as stored, with byte ranges, through the
 * read-only library reader. Others are decoded by ffmpeg and sent as FLAC
 * while they play. ffmpeg only ever reads: its one input is the library file
 * (opened by path, file protocol only), its one output is a pipe to this
 * process, and nothing is written to disk. `transcodeArgs` is pure and tested.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

export type ByteRange = { readonly start: number; readonly end: number };

/**
 * Parses a single-range `Range: bytes=…` header. Returns null when there is
 * none (send the whole file), or 'invalid' when it cannot be satisfied (416).
 * Multiple ranges are not supported; browsers do not ask for them for media.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size === 0) return 'invalid';
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return 'invalid';
  let start: number;
  let end: number;
  if (first === '') {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(last));
    end = size - 1;
  } else {
    start = Number(first);
    end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

/**
 * ffmpeg arguments that decode `absolute` from `startSeconds` and write FLAC
 * to stdout. DSD (at 2.8 MHz and up) is resampled to 88.2 kHz / 24 bit,
 * which FLAC and browsers handle; everything else keeps its own resolution.
 */
export function transcodeArgs(
  absolute: string,
  startSeconds: number,
  codec: string | null,
): string[] {
  const dsd = codec !== null && /^DSD/i.test(codec);
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    // Input options: local files only, so a path can never be read as a URL.
    '-protocol_whitelist',
    'file',
    ...(startSeconds > 0 ? ['-ss', startSeconds.toFixed(3)] : []),
    '-i',
    `file:${absolute}`,
    '-map',
    '0:a:0',
    '-vn',
    ...(dsd ? ['-af', 'aresample=88200', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'] : []),
    '-c:a',
    'flac',
    '-compression_level',
    '0',
    '-f',
    'flac',
    'pipe:1',
  ];
}

export interface Transcoder {
  /** A FLAC stream of the file, or null when too many conversions are running. */
  stream(absolute: string, startSeconds: number, codec: string | null): Readable | null;
}

/**
 * Runs ffmpeg for formats browsers cannot play. A few conversions at once is
 * plenty for one listener; more are refused rather than queued, so a
 * runaway client cannot pile up processes.
 */
export function createTranscoder({
  command = 'ffmpeg',
  maxConcurrent = 3,
}: {
  command?: string;
  maxConcurrent?: number;
} = {}): Transcoder {
  const running = new Set<ChildProcess>();
  return {
    stream(absolute, startSeconds, codec) {
      if (running.size >= maxConcurrent) return null;
      const child = spawn(command, transcodeArgs(absolute, startSeconds, codec), {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
      });
      running.add(child);
      child.once('exit', () => running.delete(child));
      child.once('error', () => running.delete(child));
      // Ending or abandoning the stream stops the process.
      child.stdout.once('close', () => {
        if (child.exitCode === null) child.kill('SIGKILL');
      });
      return child.stdout;
    },
  };
}
