import { describe, expect, it } from 'vitest';
import { apiUrl } from './api.ts';
import {
  formatBytes,
  formatDuration,
  formatLongDuration,
  formatResolution,
  formatSampleRate,
  formatSpec,
  isHiRes,
  plural,
  shortCodec,
} from './format.ts';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [61_000, '1:01'],
    [599_499, '9:59'],
    [3_725_000, '1:02:05'],
    [null, '—'],
  ])('%s → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatLongDuration', () => {
  it.each([
    [46 * 60_000, '46 min'],
    [(3 * 60 + 12) * 60_000, '3 h 12 min'],
    [(4 * 24 + 2) * 3_600_000, '4 days 2 h'],
  ])('%s → %s', (ms, expected) => {
    expect(formatLongDuration(ms)).toBe(expected);
  });
});

describe('audio specs', () => {
  it.each([
    [24, 96_000, '24/96'],
    [16, 44_100, '16/44.1'],
    [24, 88_200, '24/88.2'],
    [null, 44_100, '44.1 kHz'],
    [16, null, '—'],
  ])('resolution %s/%s → %s', (bits, rate, expected) => {
    expect(formatResolution(bits, rate)).toBe(expected);
  });

  it('formats a full spec line', () => {
    expect(formatSpec({ codec: 'FLAC', bitDepth: 24, sampleRate: 96_000, channels: 2 })).toBe(
      'FLAC · 24 bit / 96 kHz · Stereo',
    );
    expect(formatSpec({ codec: 'MPEG 1 Layer 3', bitDepth: null, sampleRate: 44_100 })).toBe(
      'MP3 · 44.1 kHz',
    );
  });

  it('recognizes hi-res', () => {
    expect(isHiRes(24, 44_100)).toBe(true);
    expect(isHiRes(16, 96_000)).toBe(true);
    expect(isHiRes(16, 44_100)).toBe(false);
    expect(isHiRes(null, 48_000)).toBe(false);
  });

  it('shortens parser codec names', () => {
    expect(shortCodec('MPEG 1 Layer 3')).toBe('MP3');
    expect(shortCodec('ALAC')).toBe('ALAC');
    expect(formatSampleRate(2_822_400)).toBe('2822.4 kHz');
  });
});

describe('formatBytes / plural', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(280 * 1024 * 1024)).toBe('280 MB');
  });

  it('pluralizes', () => {
    expect(plural(1, 'album')).toBe('1 album');
    expect(plural(1200, 'track')).toBe('1,200 tracks');
  });
});

describe('apiUrl', () => {
  it('drops empty values and encodes the rest', () => {
    expect(apiUrl('albums', { q: 'sigur rós', page: 2, codec: '', genreId: undefined })).toBe(
      '/api/albums?q=sigur+r%C3%B3s&page=2',
    );
    expect(apiUrl('stats')).toBe('/api/stats');
  });
});
