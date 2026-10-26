/**
 * A standard FLAC file starts with "fLaC", then the mandatory STREAMINFO
 * block: a 4-byte block header followed by 34 bytes of data, whose last 16
 * bytes are the MD5 of the decoded audio. That puts the MD5 at bytes 26–41.
 *
 * music-metadata parses this field but does not expose it for FLAC, so we
 * read it ourselves from the first 42 bytes.
 */
export const FLAC_HEADER_BYTES = 42;

const MAGIC = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const STREAMINFO_TYPE = 0;
const STREAMINFO_LENGTH = 34;
const MD5_OFFSET = 26;

/**
 * Returns the hex audio MD5, or null when the header is not a plain FLAC
 * STREAMINFO (e.g. an ID3 tag was prepended) or the encoder left the MD5
 * unset (all zeros).
 */
export function flacAudioMd5(header: Uint8Array): string | null {
  if (header.length < FLAC_HEADER_BYTES) return null;
  if (MAGIC.some((byte, i) => header[i] !== byte)) return null;

  const blockType = (header[4] ?? 0) & 0x7f;
  const blockLength = ((header[5] ?? 0) << 16) | ((header[6] ?? 0) << 8) | (header[7] ?? 0);
  if (blockType !== STREAMINFO_TYPE || blockLength !== STREAMINFO_LENGTH) return null;

  const md5 = header.subarray(MD5_OFFSET, MD5_OFFSET + 16);
  if (md5.every((byte) => byte === 0)) return null;
  return Buffer.from(md5).toString('hex');
}
