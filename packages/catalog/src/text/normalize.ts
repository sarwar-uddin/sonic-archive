/**
 * Produces a matching key for names: "Björk", "bjork" and " BJÖRK " all map
 * to "bjork". Keys are for identity and lookup only, never for display.
 *
 * NFKD splits accented letters into base letter + combining mark (and folds
 * compatibility forms such as full-width letters). Only the general-purpose
 * diacritics block (U+0300–U+036F) is removed: stripping every mark (\p{M})
 * would merge ガ with カ and break Indic scripts, whose vowel signs are marks.
 * NFC then recomposes whatever remains (kana, Hangul).
 */
export function nameKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
