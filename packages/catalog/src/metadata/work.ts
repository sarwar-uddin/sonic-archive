/**
 * Pressings of one album: the same artist and title, ripped from different
 * CDs (a Japanese first press, a later SHM-CD…). Each pressing is its own
 * album, since each folder is one release (ADR 0007); this key groups them.
 */
import { nameKey } from '../text/normalize.ts';

/** Words that name an edition rather than the album. */
const EDITION_WORDS =
  /\b(remaster(ed)?|deluxe|edition|anniversary|expanded|bonus|version|reissue|mono|stereo|japan(ese)?|\d+(st|nd|rd|th))\b/g;

/**
 * "Master Of Puppets" and "Master of Puppets (Remastered)" by the same
 * artist share a key; different artists or titles never do. Null for an
 * album without an artist, which cannot be matched reliably.
 */
export function workKey(artist: string | null, title: string): string | null {
  if (artist === null) return null;
  const core = nameKey(title.replace(/[([{][^()[\]{}]*[)\]}]/g, ' '))
    .replace(EDITION_WORDS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return core === '' ? null : `${nameKey(artist)}\u0000${core}`;
}
