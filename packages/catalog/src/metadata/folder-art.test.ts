import { describe, expect, it } from 'vitest';
import { chooseFolderArtwork, coverScore, nameTokens } from './folder-art.ts';

describe('nameTokens', () => {
  it('splits on punctuation and letter/digit boundaries', () => {
    expect(nameTokens('Libreto_00Portada.jpg')).toEqual(['libreto', '00', 'portada']);
    expect(nameTokens('Cover-Out.tif')).toEqual(['cover', 'out']);
    expect(nameTokens('cd1 funda delantera.jpg')).toEqual(['cd', '1', 'funda', 'delantera']);
  });
});

describe('chooseFolderArtwork', () => {
  // Every case below comes from real rips in the collection this was built for.
  it.each([
    [['folder.jpg'], 'folder.jpg'],
    [['Folder.JPG', 'Artwork/front.png'], 'Folder.JPG'],
    [
      ['ART/Disc.tif', 'ART/Cover-Out.tif', 'ART/Back.tif', 'ART/Cover-In.tif', 'ART/Colma.jpg'],
      'ART/Cover-Out.tif',
    ],
    [['Artwork/cover 2.jpg', 'Artwork/cover 1.jpg'], 'Artwork/cover 1.jpg'],
    [
      [
        'Artwork/folleto03.jpg',
        'Artwork/digipack2.jpg',
        'Artwork/funda portada.jpg',
        'Artwork/cd1 funda delantera.jpg',
      ],
      'Artwork/funda portada.jpg',
    ],
    [
      ['Scans/Libreto_04.jpg', 'Scans/Libreto_00Portada.jpg', 'Scans/LibretoJapo_00Portada.jpg'],
      'Scans/LibretoJapo_00Portada.jpg',
    ],
    [
      ['Scans/Scan_2.jpg', 'Scans/Scan_4.jpg', 'Scans/Scan_1.jpg', 'Scans/disk.jpg'],
      'Scans/Scan_1.jpg',
    ],
    [
      ['Artwork/Booklet 18.jpg', 'Artwork/Booklet 01.jpg', 'Artwork/Booklet 17.jpg'],
      'Artwork/Booklet 01.jpg',
    ],
    [
      ['Look/Senza nome-scandito-02.jpg', 'Look/Senza nome-scandito-01.jpg'],
      'Look/Senza nome-scandito-01.jpg',
    ],
    [['front.jpg', 'Scans/Libreto_00Portada.jpg'], 'front.jpg'],
    [['cover.png', 'cover.jpg'], 'cover.jpg'],
  ])('%j → %s', (candidates, expected) => {
    expect(chooseFolderArtwork(candidates)).toBe(expected);
  });

  it.each([
    [[]],
    [['back.jpg', 'cd.png', 'inlay.jpg', 'Scans/disk.jpg']],
    [['band.jpg', 'logo.png']],
    [['cover.bmp', 'cover.svg', 'folder.txt']],
    [['Artwork/Scans/cover.jpg']],
  ])('chooses nothing from %j', (candidates) => {
    expect(chooseFolderArtwork(candidates)).toBeNull();
  });
});

describe('coverScore', () => {
  it('ranks a disc sleeve below the album sleeve', () => {
    expect(coverScore('funda portada.jpg')).toBeGreaterThan(coverScore('cd1 funda delantera.jpg'));
    expect(coverScore('Cover-Out.tif')).toBeGreaterThan(coverScore('Cover-In.tif'));
  });
});
