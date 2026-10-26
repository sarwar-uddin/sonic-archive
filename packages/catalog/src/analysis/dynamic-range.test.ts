import { describe, expect, it } from 'vitest';
import { DynamicRangeMeter } from './dynamic-range.ts';

const RATE = 8000;

/** Interleaved stereo frames from a per-frame function. */
function frames(seconds: number, f: (t: number) => number): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = f(i / RATE);
    out[2 * i] = v;
    out[2 * i + 1] = v;
  }
  return out;
}

const sine = (amplitude: number) => (t: number) => amplitude * Math.sin(2 * Math.PI * 440 * t);

describe('DynamicRangeMeter', () => {
  it('measures a steady full-scale sine as DR0 at 0 dBFS', () => {
    const meter = new DynamicRangeMeter(2, RATE);
    meter.push(frames(30, sine(1)));
    const r = meter.result();
    expect(r.dr).toBe(0);
    expect(r.peakDb).toBeCloseTo(0, 1);
  });

  it('is level-independent: a quieter sine is still DR0', () => {
    const meter = new DynamicRangeMeter(2, RATE);
    meter.push(frames(30, sine(0.25)));
    expect(meter.result()).toMatchObject({ dr: 0 });
    expect(meter.result().peakDb).toBeCloseTo(-12, 0);
  });

  it('rises with dynamics: quiet music with occasional full-scale hits', () => {
    // A -20 dB sine, with two 2 ms full-scale bursts in different blocks
    // (short, so they barely raise those blocks' RMS).
    const meter = new DynamicRangeMeter(2, RATE);
    meter.push(
      frames(60, (t) => {
        const burst = (t > 10 && t < 10.002) || (t > 40 && t < 40.002);
        return burst ? Math.sign(Math.sin(2 * Math.PI * 440 * t)) : sine(0.1)(t);
      }),
    );
    // Peak reference 1.0 against an RMS reference near 0.1: about 20 dB.
    expect(meter.result().dr).toBe(20);
  });

  it('ignores a single click: the second highest peak is the reference', () => {
    const meter = new DynamicRangeMeter(2, RATE);
    meter.push(frames(30, (t) => (t > 5 && t < 5.001 ? 1 : sine(0.5)(t))));
    expect(meter.result().dr).toBe(0);
  });

  it('returns nothing for silence, and accepts audio in any chunk sizes', () => {
    const silent = new DynamicRangeMeter(2, RATE);
    silent.push(new Float32Array(RATE * 2 * 5));
    expect(silent.result()).toEqual({ dr: null, drExact: null, peakDb: null });

    const whole = new DynamicRangeMeter(2, RATE);
    const pieces = new DynamicRangeMeter(2, RATE);
    const audio = frames(20, (t) => sine(0.3 + 0.2 * Math.sin(t))(t));
    whole.push(audio);
    for (let i = 0; i < audio.length; i += 2 * 999) pieces.push(audio.subarray(i, i + 2 * 999));
    expect(pieces.result()).toEqual(whole.result());
  });
});
