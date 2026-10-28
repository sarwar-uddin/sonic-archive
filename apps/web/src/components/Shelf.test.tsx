import { describe, expect, it } from 'vitest';
import { colorFromPixels } from '../lib/cover-color.ts';
import { catalogueNumber, shelfLetter, spineTitle } from './Shelf.tsx';

describe('catalogueNumber', () => {
  it.each([
    [['1991 Japan TECP-23893 Teichiku'], 'TECP-23893'],
    [['1986 Japan 32DP 448', '1st press'], '32DP 448'],
    [['CDP 7 46034 2', '1st UK'], null],
    [['Special Edition'], null],
    [[], null],
  ])('%j → %s', (edition, expected) => {
    expect(catalogueNumber(edition)).toBe(expected);
  });
});

describe('spineTitle', () => {
  it.each([
    ['Black Sabbath', 'Black Sabbath', null],
    ['PORCUPINE TREE', 'Porcupine Tree', null],
    ['The Doors', 'Doors', null],
    ['Ísold', 'Isold!', null],
    ['Black Sabbath', 'Paranoid', 'Paranoid'],
    ['Metallica', 'Metallica (Remastered)', 'Metallica (Remastered)'],
    [null, 'Untitled', 'Untitled'],
  ])('%s / %s → %s', (artist, title, expected) => {
    expect(spineTitle(artist, title)).toBe(expected);
  });
});

describe('colorFromPixels', () => {
  const pixels = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

  it('leans to the vivid colors of a cover, and picks readable ink', () => {
    // Mostly black with one red pixel: the red dominates the tint.
    const red = colorFromPixels(pixels([0, 0, 0, 255], [0, 0, 0, 255], [220, 30, 20, 255]));
    expect(red?.background).toMatch(/^rgb\((\d+) (\d+) (\d+)\)$/);
    const [r, g, b] = (red?.background.match(/\d+/g) ?? []).map(Number) as [number, number, number];
    expect(r).toBeGreaterThan(g * 3);
    expect(r).toBeGreaterThan(b * 3);
    expect(red?.ink).toBe('#ece7db');
    expect(colorFromPixels(pixels([240, 235, 220, 255]))?.ink).toBe('#0d0d0c');
  });

  it('ignores transparent pixels', () => {
    expect(colorFromPixels(pixels([255, 0, 0, 0]))).toBeNull();
  });
});

describe('shelfLetter', () => {
  it.each([
    ['Ísold', 'I'],
    ['The Doors', 'D'],
    ['2Pac', '#'],
    ['Дискография', 'Д'],
    [null, '?'],
  ])('%s → %s', (artist, letter) => {
    expect(shelfLetter(artist)).toBe(letter);
  });
});
