import { describe, expect, it } from 'vitest';
import { decodeCueBytes, parseCueSheet } from './cue.ts';

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
