/**
 * How a browser can play each audio file. Browsers decode FLAC, MP3, Ogg
 * (Vorbis/Opus), PCM WAV and AAC natively; those files are sent as they are,
 * with byte ranges for seeking. Everything else (ALAC, Monkey's Audio,
 * WavPack, DSD, AIFF) is converted to FLAC while it plays: lossless, never
 * written to disk.
 */
import path from 'node:path';

export type Playback =
  | { readonly mode: 'direct'; readonly mime: string }
  | { readonly mode: 'transcode' };

const DIRECT: Readonly<Record<string, { mime: string; codecs?: RegExp }>> = {
  '.flac': { mime: 'audio/flac' },
  '.mp3': { mime: 'audio/mpeg' },
  '.ogg': { mime: 'audio/ogg' },
  '.opus': { mime: 'audio/ogg' },
  '.wav': { mime: 'audio/wav', codecs: /^PCM/i },
  // An .m4a may hold AAC (playable) or ALAC (not).
  '.m4a': { mime: 'audio/mp4', codecs: /AAC/i },
};

export function playbackOf(relPath: string, codec: string | null): Playback {
  const direct = DIRECT[path.extname(relPath).toLowerCase()];
  if (direct && (!direct.codecs || (codec !== null && direct.codecs.test(codec)))) {
    return { mode: 'direct', mime: direct.mime };
  }
  return { mode: 'transcode' };
}
