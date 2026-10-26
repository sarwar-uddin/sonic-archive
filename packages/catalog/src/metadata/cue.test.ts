import { describe, expect, it } from 'vitest';
import { type CueSheet, cueSegments, decodeCueBytes, matchCueSheet, parseCueSheet } from './cue.ts';

// Shape of an EAC sheet from the collection this was built for.
const EAC = `REM GENRE "Hard Rock"\r
REM DATE 1970\r
REM DISCID 6609E008\r
REM COMMENT "ExactAudioCopy v1.0b3"\r
PERFORMER "Black Sabbath"\r
TITLE "Paranoid (TECP-23893)"\r
FILE "Black Sabbath - Paranoid (TECP-23893).flac" WAVE\r
  TRACK 01 AUDIO\r
    TITLE "War Pigs"\r
    PERFORMER "Black Sabbath"\r
    INDEX 01 00:00:00\r
  TRACK 02 AUDIO\r
    TITLE "Paranoid"\r
    PERFORMER "Black Sabbath"\r
    INDEX 00 07:56:67\r
    INDEX 01 07:58:37\r
`;

describe('parseCueSheet', () => {
  it('reads album fields, files and tracks', () => {
    expect(parseCueSheet(EAC)).toEqual({
      performer: 'Black Sabbath',
      title: 'Paranoid (TECP-23893)',
      year: 1970,
      genre: 'Hard Rock',
      files: ['Black Sabbath - Paranoid (TECP-23893).flac'],
      tracks: [
        { number: 1, title: 'War Pigs', performer: 'Black Sabbath', startMs: 0 },
        { number: 2, title: 'Paranoid', performer: 'Black Sabbath', startMs: 478_493 },
      ],
    });
  });

  it('keeps album fields separate from track fields', () => {
    const sheet = parseCueSheet(
      'FILE x.flac WAVE\n TRACK 1 AUDIO\n  TITLE "Only a track"\n  REM DATE 1999\n',
    );
    expect(sheet).toMatchObject({ title: null, year: null, files: ['x.flac'] });
    expect(sheet.tracks[0]?.title).toBe('Only a track');
  });

  it('treats empty values as missing and tolerates a BOM and junk lines', () => {
    expect(parseCueSheet('﻿PERFORMER ""\nREM COMPOSER ""\nGARBAGE line\nTITLE "X"')).toMatchObject({
      performer: null,
      title: 'X',
    });
  });
});

describe('decodeCueBytes', () => {
  it('prefers UTF-8 and falls back to Windows-1252', () => {
    expect(decodeCueBytes(new TextEncoder().encode('TITLE "Ágætis"'))).toBe('TITLE "Ágætis"');
    expect(
      decodeCueBytes(new Uint8Array([0x54, 0x49, 0x54, 0x4c, 0x45, 0x20, 0xc9, 0x74, 0xe9])),
    ).toBe('TITLE Été');
  });
});

function sheet(files: string[], starts: (number | null)[] = []): CueSheet {
  return {
    performer: null,
    title: null,
    year: null,
    genre: null,
    files,
    tracks: starts.map((startMs, i) => ({
      number: i + 1,
      title: `T${i + 1}`,
      performer: null,
      startMs,
    })),
  };
}

describe('matchCueSheet', () => {
  const flac = { name: 'Album.flac.cue', sheet: sheet(['Album.flac']) };
  const wav = { name: 'Album.wav.cue', sheet: sheet(['Album.wav']) };

  it('prefers the sheet naming the exact file', () => {
    expect(matchCueSheet([wav, flac], 'Album.flac')).toEqual({
      sheet: flac.sheet,
      namesFile: true,
    });
  });

  it('accepts the same name with another extension, ignoring spacing', () => {
    const more = { name: 'x.cue', sheet: sheet(['Pink Floyd - More .wav']) };
    expect(matchCueSheet([more], 'Pink Floyd - More  .flac')).toEqual({
      sheet: more.sheet,
      namesFile: true,
    });
    expect(matchCueSheet([wav], 'album.FLAC')?.namesFile).toBe(true);
  });

  it('falls back to the only sheet, without trusting it to split', () => {
    expect(matchCueSheet([wav], 'Other.flac')).toEqual({ sheet: wav.sheet, namesFile: false });
    expect(matchCueSheet([wav, flac], 'Other.flac')).toBeNull();
    expect(matchCueSheet([], 'Album.flac')).toBeNull();
  });
});

describe('cueSegments', () => {
  it('runs each track to the next one, and the last to the end of the file', () => {
    expect(cueSegments(sheet(['a.wav'], [0, 1000, 2500]), 4000)).toEqual([
      { number: 1, title: 'T1', performer: null, startMs: 0, endMs: 1000, durationMs: 1000 },
      { number: 2, title: 'T2', performer: null, startMs: 1000, endMs: 2500, durationMs: 1500 },
      { number: 3, title: 'T3', performer: null, startMs: 2500, endMs: null, durationMs: 1500 },
    ]);
  });

  it('leaves the last duration unknown without a file duration', () => {
    expect(cueSegments(sheet(['a.wav'], [0, 1000]), null)?.[1]?.durationMs).toBeNull();
  });

  it.each([
    ['several files (a per-track rip)', sheet(['1.wav', '2.wav'], [0, 0])],
    ['a single track', sheet(['a.wav'], [0])],
    ['a track without INDEX 01', sheet(['a.wav'], [0, null])],
    ['start times out of order', sheet(['a.wav'], [0, 5000, 3000])],
  ])('refuses %s', (_, s) => {
    expect(cueSegments(s, 10_000)).toBeNull();
  });
});
