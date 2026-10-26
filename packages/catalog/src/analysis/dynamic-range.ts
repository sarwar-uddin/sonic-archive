/**
 * The dynamic range (DR) measurement used by the Dynamic Range Database and
 * foobar2000's DR Meter, from the Pleasurize Music Foundation's "TT DR
 * Offline Meter". Pure: feed it decoded samples, read the result.
 *
 * Per channel, the audio is cut into 3-second blocks. Each block gets an RMS
 * value (scaled by √2, so a full-scale sine measures 0 dB, like its peak)
 * and a peak. The loudest 20% of blocks give the RMS reference; the second
 * highest block peak gives the peak reference (the highest may be a single
 * click). DR = 20·log10(peak / RMS), averaged over channels and rounded.
 * Heavily compressed modern masters measure DR5–7; dynamic ones DR12 and up.
 */

const BLOCK_SECONDS = 3;
const TOP_SHARE = 0.2;

export interface DynamicRange {
  /** Rounded DR value, or null for silence. */
  readonly dr: number | null;
  /** Unrounded, for averaging tracks into an album value. */
  readonly drExact: number | null;
  /** Highest sample, in dBFS (0 = full scale); null for silence. */
  readonly peakDb: number | null;
}

export class DynamicRangeMeter {
  readonly #channels: number;
  readonly #blockFrames: number;
  readonly #sumSquares: Float64Array;
  readonly #peaks: Float64Array;
  #framesInBlock = 0;
  readonly #blockRms: number[][];
  readonly #blockPeaks: number[][];

  constructor(channels: number, sampleRate: number) {
    if (channels < 1 || sampleRate < 1) throw new Error('Invalid audio format.');
    this.#channels = channels;
    this.#blockFrames = Math.round(sampleRate * BLOCK_SECONDS);
    this.#sumSquares = new Float64Array(channels);
    this.#peaks = new Float64Array(channels);
    this.#blockRms = Array.from({ length: channels }, () => []);
    this.#blockPeaks = Array.from({ length: channels }, () => []);
  }

  /** Interleaved samples (−1..1); any number of whole frames. */
  push(samples: Float32Array): void {
    const channels = this.#channels;
    for (let i = 0; i + channels <= samples.length; i += channels) {
      for (let c = 0; c < channels; c++) {
        const x = samples[i + c] as number;
        this.#sumSquares[c] = (this.#sumSquares[c] as number) + x * x;
        const a = x < 0 ? -x : x;
        if (a > (this.#peaks[c] as number)) this.#peaks[c] = a;
      }
      if (++this.#framesInBlock === this.#blockFrames) this.#closeBlock();
    }
  }

  #closeBlock(): void {
    if (this.#framesInBlock === 0) return;
    for (let c = 0; c < this.#channels; c++) {
      this.#blockRms[c]?.push(
        Math.sqrt((2 * (this.#sumSquares[c] as number)) / this.#framesInBlock),
      );
      this.#blockPeaks[c]?.push(this.#peaks[c] as number);
      this.#sumSquares[c] = 0;
      this.#peaks[c] = 0;
    }
    this.#framesInBlock = 0;
  }

  result(): DynamicRange {
    // A trailing partial block counts, as in the reference meter.
    this.#closeBlock();
    const perChannel: number[] = [];
    let peak = 0;
    for (let c = 0; c < this.#channels; c++) {
      const rms = [...(this.#blockRms[c] ?? [])].sort((a, b) => b - a);
      const peaks = [...(this.#blockPeaks[c] ?? [])].sort((a, b) => b - a);
      if (rms.length === 0) continue;
      peak = Math.max(peak, peaks[0] ?? 0);
      const top = rms.slice(0, Math.max(1, Math.floor(rms.length * TOP_SHARE)));
      const reference = Math.sqrt(top.reduce((sum, r) => sum + r * r, 0) / top.length);
      const second = peaks[1] ?? peaks[0] ?? 0;
      if (reference > 0 && second > 0) perChannel.push(20 * Math.log10(second / reference));
    }
    if (perChannel.length === 0 || peak === 0) return { dr: null, drExact: null, peakDb: null };
    const exact = perChannel.reduce((a, b) => a + b, 0) / perChannel.length;
    // `|| 0` turns a rounded -0 into 0.
    return { dr: Math.round(exact) || 0, drExact: exact, peakDb: 20 * Math.log10(peak) };
  }
}
