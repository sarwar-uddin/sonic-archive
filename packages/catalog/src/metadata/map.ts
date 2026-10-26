import path from 'node:path';
import type { IAudioMetadata, IPicture } from 'music-metadata';
import type { TrackValues } from '../db/catalog-repository.ts';
import { nameKey } from '../text/normalize.ts';

export interface AlbumRecord {
  /** `mbid:<id>`, `tag:<album artist key>|<album key>`, or `dir:<folder>`. */
  readonly groupKey: string;
  readonly title: string;
  readonly albumArtist: string | null;
  readonly year: number | null;
  readonly musicbrainzAlbumId: string | null;
  readonly totalDiscs: number | null;
}

export interface PictureRecord {
  readonly data: Uint8Array;
  readonly mime: string;
}

export interface CatalogRecord {
  readonly track: Omit<TrackValues, 'fileId' | 'albumId'>;
  readonly album: AlbumRecord;
  /** Performing artists in tag order. */
  readonly artists: readonly string[];
  readonly composers: readonly string[];
  readonly genres: readonly string[];
  readonly picture: PictureRecord | null;
}

/** Used when a compilation has no album-artist tag. */
export const VARIOUS_ARTISTS = 'Various Artists';

/**
 * Disc subfolders as rippers actually name them: "CD1", "Disc 2", "Disc 1of2",
 * "CD 1 (50DP361)", "CD2 - Bonus CD", "CD1 ]CD_X_X001J, JP]".
 */
const DISC_FOLDER = /^(cd|disc|disk)[\s._-]*\d+/i;

/**
 * Maps parsed tags to catalog records. Pure: no I/O, so every rule here is
 * unit-testable with hand-built inputs.
 */
export function toCatalogRecord(metadata: IAudioMetadata, relPath: string): CatalogRecord {
  const { common, format } = metadata;

  const artists = uniqueByKey((common.artists ?? [common.artist]).map(clean));
  const taggedArtist = clean(common.artist);
  // music-metadata puts only the first value of a multi-value ARTIST in
  // `artist`, so build the display string from all of them in that case.
  const displayArtist =
    artists.length > 1 ? artists.join(', ') : (taggedArtist ?? artists[0] ?? null);

  const albumArtist =
    clean(common.albumartist) ?? (common.compilation ? VARIOUS_ARTISTS : (artists[0] ?? null));
  // A title that is only a pressing code, like "(CDP 7 46384 2) [1st UK]",
  // says nothing about the album: fall back to the folder name instead.
  const taggedAlbum = clean(common.album);
  const albumTitle = taggedAlbum && isPressingOnly(taggedAlbum) ? null : taggedAlbum;
  const mbid = clean(common.musicbrainz_albumid)?.toLowerCase() ?? null;
  const albumDir = albumFolder(relPath);
  const fromFolder = albumTitle ? null : folderTitle(albumDir);
  const year = parseYear(common.year, common.date) ?? fromFolder?.year ?? null;

  const groupKey = mbid
    ? `mbid:${mbid}`
    : albumTitle
      ? `tag:${nameKey(albumArtist ?? '')}|${nameKey(albumTitle)}`
      : `dir:${albumDir}`;

  const lossless = format.lossless ?? null;
  const picture = pickPicture(common.picture);

  return {
    track: {
      title: clean(common.title),
      displayArtist,
      trackNo: positiveInt(common.track.no),
      trackTotal: positiveInt(common.track.of),
      discNo: positiveInt(common.disk.no),
      discTotal: positiveInt(common.disk.of),
      year,
      durationMs: format.duration === undefined ? null : Math.round(format.duration * 1000),
      codec: clean(format.codec),
      container: clean(format.container),
      lossless,
      sampleRate: positiveInt(format.sampleRate),
      // Lossy decoders may report a nominal depth; it is meaningless there.
      bitDepth: lossless ? positiveInt(format.bitsPerSample) : null,
      channels: positiveInt(format.numberOfChannels),
      bitrate: format.bitrate === undefined ? null : Math.round(format.bitrate),
      hasEmbeddedArt: picture !== null,
    },
    album: {
      groupKey,
      // Untagged files are grouped by folder so they remain browsable.
      title: albumTitle ?? fromFolder?.title ?? 'Unknown Album',
      albumArtist,
      year,
      musicbrainzAlbumId: mbid,
      totalDiscs: positiveInt(common.disk.of),
    },
    artists,
    composers: uniqueByKey((common.composer ?? []).map(clean)),
    // Some taggers store several genres in one field: "Classical; Chamber".
    genres: uniqueByKey((common.genre ?? []).flatMap((g) => g.split(';')).map(clean)),
    picture,
  };
}

/** The album's folder: the file's directory, or its parent for CD1/Disc 2 folders. */
export function albumFolder(relPath: string): string {
  const dir = path.dirname(relPath);
  const folder = DISC_FOLDER.test(path.basename(dir)) ? path.dirname(dir) : dir;
  return folder === '.' ? '' : folder;
}

/**
 * A readable album title (and year) from a folder path, for files without
 * album tags. Bracketed pressing details are dropped (they are shown as the
 * album's edition instead) and a leading year becomes the album year:
 * "1970 Paranoid [1991 Japan TECP-23893]" → "Paranoid", 1970. A folder named
 * only by its pressing, like "(CDP 7 46034 2) [1st UK]", uses its parent.
 */
export function folderTitle(albumDir: string): { title: string; year: number | null } {
  const base = path.basename(albumDir);
  if (base === '') return { title: 'Unknown Album', year: null };
  const parent = path.basename(path.dirname(albumDir));
  const name = /^\s*[([{]/.test(base) && parent !== '' && parent !== '.' ? parent : base;
  const stripped = name
    .replace(/[([{][^()[\]{}]*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–.]+$/, '')
    .trim();
  const yearMatch = /^(\d{4})\s*[-–.]?\s+(.+)$/.exec(stripped);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const title = (yearMatch?.[2] ?? stripped).trim();
  return title === '' ? { title: name, year: null } : { title, year };
}

function isPressingOnly(title: string): boolean {
  return title.replace(/[([{][^()[\]{}]*[)\]}]/g, '').trim() === '';
}

function clean(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  // Some taggers leave NUL terminators or padding inside values.
  const cleaned = value.replaceAll('\0', '').trim();
  return cleaned === '' ? null : cleaned;
}

function uniqueByKey(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value === null) continue;
    const key = nameKey(value);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function positiveInt(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function parseYear(year: number | undefined, date: string | undefined): number | null {
  const candidate = year ?? Number(/^\s*(\d{4})/.exec(date ?? '')?.[1]);
  return Number.isInteger(candidate) && candidate >= 1000 && candidate <= 9999 ? candidate : null;
}

function pickPicture(pictures: readonly IPicture[] | undefined): PictureRecord | null {
  if (!pictures || pictures.length === 0) return null;
  const chosen = pictures.find((p) => p.type === 'Cover (front)') ?? pictures[0];
  if (!chosen || chosen.data.length === 0) return null;
  const mime =
    chosen.format.toLowerCase() === 'image/jpg' ? 'image/jpeg' : chosen.format.toLowerCase();
  return { data: chosen.data, mime };
}
