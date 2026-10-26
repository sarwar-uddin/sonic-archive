/**
 * Parser for CUE sheets, as written by EAC and similar rippers next to a
 * single-file CD image. Pure: takes the sheet's text, returns its contents.
 *
 * Album-level fields fill gaps in the image's tags (`withCueSheet`), and the
 * track list splits the image into tracks (`cueSegments`).
 */
import path from 'node:path';

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

/** A sheet found next to an audio file, with its own file name. */
export interface NamedCueSheet {
  readonly name: string;
  readonly sheet: CueSheet;
}

export interface CueMatch {
  readonly sheet: CueSheet;
  /**
   * The sheet names this audio file in a FILE line. Only then is it trusted
   * to split the file; a lone sheet in the folder may describe other files.
   */
  readonly namesFile: boolean;
}

/**
 * Picks the sheet for an audio file among the sheets in its folder.
 *
 * EAC often writes the sheet before compressing, so it names "Album.wav"
 * while the file is "Album.flac"; and some folders hold two sheets for the
 * same image ("Album.cue" and "Album.flac.cue"). In order of preference: a
 * sheet naming the exact file, one naming the same name with another
 * extension (ignoring spacing and punctuation), or the only sheet present.
 */
export function matchCueSheet(
  sheets: readonly NamedCueSheet[],
  audioName: string,
): CueMatch | null {
  const fileName = (f: string) => path.basename(f.replaceAll('\\', '/')).toLowerCase();
  const exact = sheets.find((s) =>
    s.sheet.files.some((f) => fileName(f) === audioName.toLowerCase()),
  );
  if (exact) return { sheet: exact.sheet, namesFile: true };
  const stem = loose(audioName);
  const sameStem = sheets.find((s) => s.sheet.files.some((f) => loose(fileName(f)) === stem));
  if (sameStem) return { sheet: sameStem.sheet, namesFile: true };
  const only = sheets.length === 1 ? sheets[0] : undefined;
  return only ? { sheet: only.sheet, namesFile: false } : null;
}

/** File name without extension, lowercased, letters and digits only. */
function loose(fileName: string): string {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** One track cut from a single-file image. */
export interface CueSegment {
  readonly number: number;
  readonly title: string | null;
  readonly performer: string | null;
  readonly startMs: number;
  /** Null for the last track: it runs to the end of the file. */
  readonly endMs: number | null;
  readonly durationMs: number | null;
}

/**
 * The tracks of a single-file CD image, or null if the sheet does not
 * describe one (it lists several files, fewer than two tracks, or tracks
 * without usable start times).
 *
 * A track runs from its INDEX 01 to the next track's INDEX 01, so the gap
 * before a track belongs to the track before it, as on the CD itself when
 * played straight through. Any audio before track 1's INDEX 01 (a hidden
 * pregap track) is not part of track 1.
 */
export function cueSegments(sheet: CueSheet, fileDurationMs: number | null): CueSegment[] | null {
  if (sheet.files.length !== 1 || sheet.tracks.length < 2) return null;
  const tracks = sheet.tracks;
  for (let i = 0; i < tracks.length; i++) {
    const start = tracks[i]?.startMs ?? null;
    const previous = i === 0 ? -1 : (tracks[i - 1]?.startMs ?? null);
    if (start === null || previous === null || start <= previous) return null;
  }
  return tracks.map((track, i) => {
    const startMs = track.startMs as number;
    const endMs = tracks[i + 1]?.startMs ?? null;
    const end = endMs ?? fileDurationMs;
    return {
      number: track.number,
      title: track.title,
      performer: track.performer,
      startMs,
      endMs,
      durationMs: end === null || end < startMs ? null : end - startMs,
    };
  });
}
