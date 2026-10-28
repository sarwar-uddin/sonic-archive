/**
 * Measures dynamic range by decoding audio (`pnpm analyze`, and after each
 * scan in `start:watch`). Like playback conversion (audio.ts), ffmpeg only
 * reads: one `file:` input, raw samples to a pipe, nothing on disk.
 */
import { spawn } from 'node:child_process';
import {
  type AnalysisJob,
  type CatalogDb,
  DynamicRangeMeter,
  type DynamicsResult,
  findAnalysisJobs,
  type LibraryReader,
  saveDynamics,
} from '@sonic-archive/catalog';
import { isMissingCommand } from './ffmpeg.ts';

/** DSD is decoded at 2.8 MHz and up; analysing it at 88.2 kHz loses nothing that DR sees. */
export function decodeFormat(job: Pick<AnalysisJob, 'codec' | 'sampleRate' | 'channels'>) {
  const dsd = job.codec !== null && /^DSD/i.test(job.codec);
  return {
    sampleRate: dsd ? 88_200 : (job.sampleRate ?? 44_100),
    channels: Math.min(Math.max(job.channels ?? 2, 1), 8),
  };
}

/** ffmpeg arguments: decode one file to interleaved 32-bit float samples on stdout. */
export function decodeArgs(absolute: string, sampleRate: number, channels: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-protocol_whitelist',
    'file',
    '-i',
    `file:${absolute}`,
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    String(channels),
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1',
  ];
}

/**
 * Splits a stream of interleaved frames among the tracks of a file, by their
 * spans, and measures each. Audio outside every span (a hidden pregap) is
 * ignored.
 */
export function createSpanMeters(
  tracks: AnalysisJob['tracks'],
  sampleRate: number,
  channels: number,
) {
  const spans = tracks.map((t) => ({
    trackId: t.trackId,
    start: Math.round((t.startMs / 1000) * sampleRate),
    end: t.endMs === null ? Number.POSITIVE_INFINITY : Math.round((t.endMs / 1000) * sampleRate),
    meter: new DynamicRangeMeter(channels, sampleRate),
  }));
  let frame = 0;
  return {
    push(samples: Float32Array) {
      const frames = Math.floor(samples.length / channels);
      for (const span of spans) {
        const from = Math.max(span.start, frame);
        const to = Math.min(span.end, frame + frames);
        if (from < to)
          span.meter.push(samples.subarray((from - frame) * channels, (to - frame) * channels));
      }
      frame += frames;
    },
    results(): DynamicsResult[] {
      return spans.map((s) => {
        const r = s.meter.result();
        return { trackId: s.trackId, drExact: r.drExact, peakDb: r.peakDb };
      });
    },
  };
}

/** Decodes one file and measures its tracks. */
export async function analyzeFile(
  job: AnalysisJob,
  absolute: string,
  command = 'ffmpeg',
): Promise<DynamicsResult[]> {
  const { sampleRate, channels } = decodeFormat(job);
  const meters = createSpanMeters(job.tracks, sampleRate, channels);
  const child = spawn(command, decodeArgs(absolute, sampleRate, channels), {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  // Listen before reading: a failed spawn (no ffmpeg) emits 'error', which
  // would otherwise be thrown as an uncaught exception.
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  exited.catch(() => {});
  const frameBytes = 4 * channels;
  let rest: Buffer = Buffer.alloc(0);
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    if (stderr.length < 2000) stderr += d.toString();
  });
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    const data = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
    const usable = data.length - (data.length % frameBytes);
    // Copy into an aligned buffer: Float32Array needs a 4-byte offset.
    const samples = new Float32Array(usable / 4);
    Buffer.from(samples.buffer).set(data.subarray(0, usable));
    meters.push(samples);
    rest = data.subarray(usable);
  }
  const code = await exited;
  if (code !== 0) throw new Error(stderr.trim().split('\n').at(-1) || `ffmpeg exited with ${code}`);
  return meters.results();
}

export interface AnalyzeSummary {
  readonly files: number;
  readonly tracks: number;
  readonly failed: readonly { relPath: string; message: string }[];
  /** ffmpeg could not be started, so the run stopped at the first file. */
  readonly ffmpegMissing: boolean;
}

/** Measures every file whose tracks lack a current measurement. */
export async function analyzeLibrary(deps: {
  db: CatalogDb;
  reader: Pick<LibraryReader, 'audioFile'>;
  subpath?: string | null;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  command?: string;
}): Promise<AnalyzeSummary> {
  const jobs = findAnalysisJobs(deps.db, deps.subpath ?? null);
  const failed: { relPath: string; message: string }[] = [];
  let next = 0;
  let done = 0;
  let tracks = 0;
  let ffmpegMissing = false;
  const lane = async () => {
    while (next < jobs.length && !deps.signal?.aborted && !ffmpegMissing) {
      const job = jobs[next++] as AnalysisJob;
      try {
        const { absolute } = await deps.reader.audioFile(job.relPath);
        const results = await analyzeFile(job, absolute, deps.command);
        saveDynamics(deps.db, job, results);
        tracks += results.length;
      } catch (error) {
        // Every other file would fail the same way: stop instead.
        if (isMissingCommand(error)) {
          ffmpegMissing = true;
          return;
        }
        failed.push({ relPath: job.relPath, message: (error as Error).message });
      }
      // Count first: `onProgress?.(++done)` would skip the increment when
      // there is no callback, since optional calls skip their arguments.
      done++;
      deps.onProgress?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: deps.concurrency ?? 3 }, lane));
  return { files: done - failed.length, tracks, failed, ffmpegMissing };
}
