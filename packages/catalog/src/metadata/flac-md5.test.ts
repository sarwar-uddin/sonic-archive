import { describe, expect, it } from 'vitest';
import { FLAC_HEADER_BYTES, flacAudioMd5 } from './flac-md5.ts';

function header(md5Byte: number, overrides: Record<number, number> = {}): Uint8Array {
  const bytes = new Uint8Array(FLAC_HEADER_BYTES);
  bytes.set([0x66, 0x4c, 0x61, 0x43]); // fLaC
  bytes.set([0x00, 0x00, 0x00, 34], 4); // STREAMINFO, length 34
  bytes.fill(md5Byte, 26, 42);
  for (const [offset, value] of Object.entries(overrides)) bytes[Number(offset)] = value;
  return bytes;
}

describe('flacAudioMd5', () => {
  it('reads the MD5 from STREAMINFO', () => {
    expect(flacAudioMd5(header(0xab))).toBe('ab'.repeat(16));
  });

  it('accepts STREAMINFO flagged as the last metadata block', () => {
    expect(flacAudioMd5(header(0x01, { 4: 0x80 }))).toBe('01'.repeat(16));
  });

  it('returns null for an unset (all-zero) MD5', () => {
    expect(flacAudioMd5(header(0))).toBeNull();
  });

  it('returns null for anything that is not a plain FLAC header', () => {
    expect(flacAudioMd5(header(0xab, { 0: 0x49 }))).toBeNull(); // e.g. "ID3" prefix
    expect(flacAudioMd5(header(0xab, { 4: 0x04 }))).toBeNull(); // wrong first block
    expect(flacAudioMd5(header(0xab, { 7: 33 }))).toBeNull(); // wrong length
    expect(flacAudioMd5(header(0xab).subarray(0, 30))).toBeNull(); // truncated
  });
});
