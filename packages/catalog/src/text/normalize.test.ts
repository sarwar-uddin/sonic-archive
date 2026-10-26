import { describe, expect, it } from 'vitest';
import { nameKey } from './normalize.ts';

describe('nameKey', () => {
  it('folds case, diacritics and whitespace', () => {
    expect(nameKey('Björk')).toBe('bjork');
    expect(nameKey('  BJÖRK ')).toBe('bjork');
    expect(nameKey('Sigur  Rós')).toBe('sigur ros');
  });

  it('treats precomposed and decomposed forms alike', () => {
    expect(nameKey('Beyoncé')).toBe(nameKey('Beyoncé'));
  });

  it('folds compatibility characters', () => {
    expect(nameKey('ＡＢＣ')).toBe('abc');
  });

  it('keeps non-Latin scripts intact', () => {
    expect(nameKey('坂本龍一')).toBe('坂本龍一');
    expect(nameKey('हिन्दी')).toBe('हिन्दी');
  });

  it('does not merge kana that differ only by voicing marks', () => {
    expect(nameKey('ガ')).not.toBe(nameKey('カ'));
    expect(nameKey('ガ')).toBe('ガ');
  });
});
