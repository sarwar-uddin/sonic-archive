import path from 'node:path';
import type { IAudioMetadata, IPicture } from 'music-metadata';
import type { TrackValues } from '../db/catalog-repository.ts';
import { nameKey } from '../text/normalize.ts';
import type { CueSegment } from './cue.ts';

export interface AlbumRecord {
  /** `mbid:<id>`, `tag:<album artist key>|<album key>|<folder>`, or `dir:<folder>`. */
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
const DISC_FOLDER = /^(cd|disc|disk)[\s._-]*(\d+)/i;
/** …and "(One)", "(Two)": only in parentheses, so an album called "One" is safe. */
const WORD_DISC_FOLDER = /^\((one|two|three|four|five|six)\)$/i;
const DISC_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];

/** Whether a folder name is a disc folder of a multi-disc set. */
export function isDiscFolder(name: string): boolean {
  return discFolderNumber(name) !== null;
}

/** The disc number a folder name stands for, or null if it is not a disc folder. */
function discFolderNumber(name: string): number | null {
  const digits = DISC_FOLDER.exec(name);
  if (digits) return positiveInt(Number(digits[2]));
  const word = WORD_DISC_FOLDER.exec(name);
  return word ? DISC_WORDS.indexOf((word[1] as string).toLowerCase()) + 1 : null;
}

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
  // A disc's title often ends with its folder's name: "Album: (One)", "Album CD1".
  const taggedAlbum = withoutSuffix(clean(common.album), discFolderName(relPath));
  const albumTitle =
    taggedAlbum && isPressingOnly(taggedAlbum) ? null : cleanAlbumTitle(taggedAlbum);
  const mbid = clean(common.musicbrainz_albumid)?.toLowerCase() ?? null;
  const albumDir = albumFolder(relPath);
  const fromFolder = albumTitle ? null : folderTitle(albumDir);
  const year = parseYear(common.year, common.date) ?? fromFolder?.year ?? null;
  const title = albumTitle === null ? null : withoutLeadingYear(albumTitle, year);

  // Each folder is one release: two pressings of the same album, which share
  // a cleaned title, stay separate albums. Disc folders count as their album
  // folder, so CD1 and CD2 still join.
  const groupKey = mbid
    ? `mbid:${mbid}`
    : title
      ? `tag:${nameKey(albumArtist ?? '')}|${nameKey(title)}|${albumDir}`
      : `dir:${albumDir}`;

  const lossless = format.lossless ?? null;
  const picture = pickPicture(common.picture);

  return {
    track: {
      title: clean(common.title),
      displayArtist,
      segment: 0,
      startMs: null,
      endMs: null,
      trackNo: positiveInt(common.track.no),
      trackTotal: positiveInt(common.track.of),
      discNo: positiveInt(common.disk.no) ?? discFromFolder(relPath),
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
      title: title ?? fromFolder?.title ?? 'Unknown Album',
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

/**
 * Splits the record of a single-file CD image into one record per CUE track.
 * Album, format and genre stay as read from the image; title, performer,
 * number and length come from the sheet.
 */
export function splitByCue(
  record: CatalogRecord,
  segments: readonly CueSegment[],
): CatalogRecord[] {
  return segments.map((segment) => {
    const performer = clean(segment.performer);
    return {
      ...record,
      track: {
        ...record.track,
        segment: segment.number,
        startMs: segment.startMs,
        endMs: segment.endMs,
        title: clean(segment.title),
        displayArtist: performer ?? record.track.displayArtist,
        trackNo: segment.number,
        trackTotal: segments.length,
        durationMs: segment.durationMs,
      },
      artists: performer ? [performer] : record.artists,
      // Composer tags on an image describe the whole disc, not each track.
      composers: [],
    };
  });
}

/** Disc number from a CD1 / "Disc 2of2" / "CD 1 (50DP361)" parent folder. */
export function discFromFolder(relPath: string): number | null {
  return discFolderNumber(path.basename(path.dirname(relPath)));
}

function discFolderName(relPath: string): string | null {
  const name = path.basename(path.dirname(relPath));
  return discFolderNumber(name) === null ? null : name;
}

function withoutSuffix(title: string | null, suffix: string | null): string | null {
  if (title === null || suffix === null) return title;
  if (!title.toLowerCase().endsWith(suffix.toLowerCase())) return title;
  const rest = title.slice(0, title.length - suffix.length).replace(/[\s\-–:.,]+$/, '');
  return rest === '' ? title : rest;
}

/** The album's folder: the file's directory, or its parent for CD1/Disc 2 folders. */
export function albumFolder(relPath: string): string {
  const dir = path.dirname(relPath);
  const folder = discFolderNumber(path.basename(dir)) !== null ? path.dirname(dir) : dir;
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

const COUNTRY =
  'japan|jpn|jp|uk|usa|us|eu|europe|germany|netherlands|holland|france|italy|spain|canada|australia|korea|poland|russia|taiwan|brazil';

/** A catalogue number: TECP-23892, CP32-5108, CDVILED78, 50DP361, 7559-74014-2, 975 005-2. */
const CATALOG_NO = /\b[A-Z]{1,8}[- ]?\d{2,}|\b\d+[A-Z]{1,4}[- ]?\d{2,}|\b\d{3,}[- ]\d+/;

const PRESSING_SUFFIXES: readonly RegExp[] = [
  // "Dark Side of the Moon.CP35-3017.Japan", "The Wall.50DP361.Japan"
  new RegExp(`\\.(?=[^.]*[A-Z])(?=[^.]*\\d)[A-Z0-9][A-Z0-9 -]*(\\.(${COUNTRY}))?$`, 'i'),
  // "Ummagumma (CD 1)", "Deadwing - Japan CD1", "Deadwing - Japan Bonus Disc"
  /[\s([{-]*\b(?:(?:bonus\s+)?(?:cd|disc|disk)\s*\d+(?:\s*(?:of|\/)\s*\d+)?|bonus\s+(?:cd|disc|disk))[)\]}]?$/i,
  // "In Absentia - Japan"
  new RegExp(`\\s+[-–]\\s*(${COUNTRY})$`, 'i'),
];

/**
 * Removes pressing details that rippers append to album titles, which are
 * shown as edition chips from the folder name instead: catalogue numbers in
 * brackets ("Paranoid (TECP-23893)"), country-only brackets ("[Japan]"),
 * ".CODE.Country" suffixes, and disc markers ("(CD 1)"), so the discs of a
 * set share one title. Descriptive brackets ("(Deluxe Edition)",
 * "[Original Motion Picture Soundtrack]") are kept.
 */
export function cleanAlbumTitle(title: string | null): string | null {
  if (title === null) return null;
  let current = title;
  for (;;) {
    let next = current;
    const group = /\s*[([{]([^()[\]{}]*)[)\]}]\s*$/.exec(next);
    const inner = group?.[1] ?? '';
    if (
      group &&
      (CATALOG_NO.test(inner) || new RegExp(`^\\s*(${COUNTRY})\\s*$`, 'i').test(inner))
    ) {
      next = next.slice(0, group.index);
    }
    for (const suffix of PRESSING_SUFFIXES) next = next.replace(suffix, '');
    next = next.replace(/[\s\-–:.,]+$/, '');
    if (next === current || next === '') break;
    current = next;
  }
  return current;
}

/**
 * "1968 A Saucerful of Secrets" → "A Saucerful of Secrets" when 1968 is the
 * album's year. Titles that merely start with a number ("1984", "2112 Live")
 * are left alone.
 */
function withoutLeadingYear(title: string, year: number | null): string {
  if (year === null) return title;
  const match = /^(\d{4})\s*[-–.]?\s+(\S.*)$/.exec(title);
  return match && Number(match[1]) === year ? (match[2] as string) : title;
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
