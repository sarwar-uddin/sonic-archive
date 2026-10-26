import { describe, expect, it } from 'vitest';
import { editionFromPath, pressingCountries } from './edition.ts';

describe('editionFromPath', () => {
  // Folder names from the collection this was built for.
  it.each([
    [
      'Black Sabbath/Studio Albums/1970 Paranoid/1970 Paranoid [1991 Japan TECP-23893 Teichiku]/a.flac',
      ['1991 Japan TECP-23893 Teichiku'],
    ],
    ['Charles Mingus - Mingus Ah Um (1959, 2019, MFSL)/01.flac', ['1959, 2019, MFSL']],
    ['Pink Floyd/Studio/1971 Meddle/(CDP 7 46034 2) [1st UK]/a.flac', ['CDP 7 46034 2', '1st UK']],
    [
      'Metallica - Master Of Puppets - 1986 [SHM-CD,Blackened, UICR-1139, Japan]/01.flac',
      ['SHM-CD,Blackened, UICR-1139, Japan'],
    ],
    [
      'Death - Symbolic [Roadrunner Records, RR 8957-2, Netherlands]/01.flac',
      ['Roadrunner Records, RR 8957-2, Netherlands'],
    ],
    [
      'can - 2011 - tago mago (1971) {40th anniversary edition}/Disc 1of2/01.flac',
      ['40th anniversary edition'],
    ],
    [
      'Storm Corrosion - 2012 - Storm Corrosion (Special Edition) [FLAC]/01.flac',
      ['Special Edition'],
    ],
    ['Bangladeshi/Lossless/Miles/Albums/Miles - Proyash (1997)/01.flac', []],
    ['GYBE/1998. F♯ A♯ ∞ [2000, PCD-23058]/01.flac', ['2000, PCD-23058']],
    ['Loose/song.flac', []],
  ])('%s', (relPath, expected) => {
    expect(editionFromPath(relPath)).toEqual(expected);
  });
  it.each([
    [
      'Metallica - Discography/Albums/1986 - Master Of Puppets/1986 Japan 32DP 448 (1st press)/a.flac',
      'Master Of Puppets',
      ['1986 Japan 32DP 448', '1st press'],
    ],
    [
      'Megadeth/Studio Albums/1990 - Rust In Peace/1990 Capitol, CDP 7 91935 2, USA/a.flac',
      'Rust In Peace',
      ['1990 Capitol, CDP 7 91935 2, USA'],
    ],
    // The folder names the album itself: only its brackets are the edition.
    [
      'Death - Symbolic [Roadrunner Records, RR 8957-2]/01.flac',
      'Symbolic',
      ['Roadrunner Records, RR 8957-2'],
    ],
    // Loose tracks in an artist folder: the folder is not a pressing.
    ['Radiohead/song.flac', 'Creep', []],
    ['Radiohead/Disc 1/song.flac', 'Creep', []],
  ])('names a pressing folder as a whole: %s', (relPath, title, expected) => {
    expect(editionFromPath(relPath, title)).toEqual(expected);
  });
});

describe('pressingCountries', () => {
  it.each([
    [['1991 Japan TECP-23893 Teichiku'], ['Japan']],
    [['CDP 7 46034 2', '1st UK'], ['UK']],
    [['1959, 1983, CBS-Sony-Japan'], ['Japan']],
    [['LLLPLLPLP01, UK, Europe & US'], ['UK', 'USA', 'Europe']],
    [['Roadrunner Records, RR 8957-2, Netherlands'], ['Netherlands']],
    [['Remastered by us'], []],
    [[], []],
  ])('%j → %j', (edition, expected) => {
    expect(pressingCountries(edition)).toEqual(expected);
  });
});
