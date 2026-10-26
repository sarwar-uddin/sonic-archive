import { describe, expect, it } from 'vitest';
import { chooseFolderArtwork } from './folder-art.ts';

describe('chooseFolderArtwork', () => {
  it.each([
    [['folder.jpg'], 'folder.jpg'],
    [['folder.jpg', 'cover.jpg'], 'cover.jpg'],
    [['Folder.JPG'], 'Folder.JPG'],
    [['front.png', 'folder.jpg'], 'folder.jpg'],
    [['Artwork/front.png', 'folder.jpg'], 'folder.jpg'],
    [['Artwork/front.png', 'Artwork/back.jpg'], 'Artwork/front.png'],
    [['Scans/Cover.jpeg'], 'Scans/Cover.jpeg'],
    [['cover.png', 'cover.jpg'], 'cover.jpg'],
  ])('%j -> %s', (candidates, expected) => {
    expect(chooseFolderArtwork(candidates)).toBe(expected);
  });

  it.each([
    [[]],
    [['back.jpg', 'cd.png', 'booklet-01.jpg']],
    [['cover.bmp', 'cover.svg', 'folder.txt']],
    [['Artwork/Scans/cover.jpg']],
  ])('chooses nothing from %j', (candidates) => {
    expect(chooseFolderArtwork(candidates)).toBeNull();
  });
});
