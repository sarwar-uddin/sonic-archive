/**
 * Parser for CUE sheets, as written by EAC and similar rippers next to a
 * single-file CD image. Pure: takes the sheet's text, returns its contents.
 *
 * Only album-level fields feed the catalog today. Tracks are parsed so that
 * splitting an image into its tracks can build on this later.
 */

export interface CueTrack {
  readonly number: number;
  readonly title: string | null;
  readonly performer: string | null;
  /** Start of INDEX 01, in milliseconds from the start of the file. */
  readonly startMs: number | null;
}

export interface CueSheet {
  readonly performer: string | null;
  readonly title: string | null;
  readonly year: number | null;
  readonly genre: string | null;
  /** File names from FILE lines, as written in the sheet. */
  readonly files: readonly string[];
  readonly tracks: readonly CueTrack[];
}

/** CD frames: 75 per second. */
const FRAMES_PER_SECOND = 75;

export function parseCueSheet(text: string): CueSheet {
  let performer: string | null = null;
  let title: string | null = null;
  let year: number | null = null;
  let genre: string | null = null;
  const files: string[] = [];
  const tracks: {
    number: number;
    title: string | null;
    performer: string | null;
    startMs: number | null;
  }[] = [];

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const [keyword = '', ...rest] = line.split(/\s+/);
    const args = rest.join(' ');
    const current = tracks.at(-1);

    switch (keyword.toUpperCase()) {
      case 'PERFORMER':
        if (current) current.performer = unquote(args);
        else performer = unquote(args);
        break;
      case 'TITLE':
        if (current) current.title = unquote(args);
        else title = unquote(args);
        break;
      case 'FILE': {
        const name = /^"([^"]*)"|^(\S+)/.exec(args);
        const file = name?.[1] ?? name?.[2];
        if (file) files.push(file);
        break;
      }
      case 'TRACK': {
        const number = Number.parseInt(rest[0] ?? '', 10);
        if (Number.isInteger(number))
          tracks.push({ number, title: null, performer: null, startMs: null });
        break;
      }
      case 'INDEX':
        if (current && rest[0] === '01') current.startMs = parseTime(rest[1]);
        break;
      case 'REM': {
        const [field = '', ...value] = rest;
        const text = unquote(value.join(' '));
        if (current) break;
        if (field.toUpperCase() === 'DATE') {
          const y = Number(/\d{4}/.exec(text ?? '')?.[0]);
          year = Number.isInteger(y) && y >= 1000 && y <= 9999 ? y : null;
        } else if (field.toUpperCase() === 'GENRE') {
          genre = text;
        }
        break;
      }
    }
  }
  return { performer, title, year, genre, files, tracks };
}

function unquote(value: string): string | null {
  const text = value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
  return text === '' ? null : text;
}

/** "mm:ss:ff" (frames) → milliseconds. */
function parseTime(value: string | undefined): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [, m, s, f] = match.map(Number) as [number, number, number, number];
  return Math.round((m * 60 + s + f / FRAMES_PER_SECOND) * 1000);
}

/**
 * CUE sheets carry no encoding marker. Most are ASCII or UTF-8; older EAC
 * rips are often Windows-1252. Valid UTF-8 wins, otherwise Windows-1252.
 */
export function decodeCueBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Fills album-level gaps in parsed tags from a CUE sheet. Tags always win:
 * the sheet only supplies what the file itself does not say.
 */
export function withCueSheet<T extends { common: CueCommon }>(metadata: T, sheet: CueSheet): T {
  const c = metadata.common;
  const performer = sheet.performer ?? undefined;
  return {
    ...metadata,
    common: {
      ...c,
      album: c.album ?? sheet.title ?? undefined,
      albumartist: c.albumartist ?? performer,
      artist: c.artist ?? performer,
      artists: c.artists && c.artists.length > 0 ? c.artists : performer ? [performer] : c.artists,
      year: c.year ?? sheet.year ?? undefined,
      genre: c.genre && c.genre.length > 0 ? c.genre : sheet.genre ? [sheet.genre] : c.genre,
    },
  };
}

interface CueCommon {
  album?: string | undefined;
  albumartist?: string | undefined;
  artist?: string | undefined;
  artists?: string[] | undefined;
  year?: number | undefined;
  genre?: string[] | undefined;
}
