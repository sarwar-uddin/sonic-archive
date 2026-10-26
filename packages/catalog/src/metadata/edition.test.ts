import { describe, expect, it } from 'vitest';
import { editionFromPath } from './edition.ts';

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
});
