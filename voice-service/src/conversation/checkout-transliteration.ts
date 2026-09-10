import Sanscript from '@indic-transliteration/sanscript';

/**
 * Converts Hindi/Gujarati-script delivery values to a readable Latin-script
 * representation for the checkout form. This is transliteration, not address
 * translation: house numbers and the caller's words are preserved.
 */
export function transliterateCheckoutValue(value: string): string {
  if (!/[\u0900-\u097F\u0A80-\u0AFF]/u.test(value)) return value.trim();

  let latin = value;
  if (/[\u0900-\u097F]/u.test(latin)) {
    latin = Sanscript.t(latin, 'devanagari', 'iast', { syncope: true });
  }
  if (/[\u0A80-\u0AFF]/u.test(latin)) {
    latin = Sanscript.t(latin, 'gujarati', 'iast', { syncope: true });
  }

  // Preserve common IAST sounds before removing remaining accent marks;
  // plain NFKD would turn śāṃti into the misleading "samti".
  latin = latin
    .replace(/[śṣ]/g, 'sh').replace(/[ŚṢ]/g, 'Sh')
    .replace(/[ṃṁṅñṇ]/g, 'n').replace(/[ṂṀṄÑṆ]/g, 'N')
    .replace(/ṭ/g, 't').replace(/Ṭ/g, 'T')
    .replace(/ḍ/g, 'd').replace(/Ḍ/g, 'D')
    .replace(/ḷ/g, 'l').replace(/[ṛṝ]/g, 'r');

  return latin
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[।॥]/gu, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s,./-])([a-z])/g, (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toUpperCase()}`);
}
