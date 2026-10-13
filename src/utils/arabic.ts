/**
 * Arabic text normalization utilities for instant full-text search.
 * Handles alef variations, taa marbuta/haa, yaa/alif maqsura, and diacritics.
 */

const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670]/g;
const TATWEEL_REGEX = /\u0640/g;

/**
 * Normalizes Arabic text for consistent search indexing
 */
export function normalizeArabic(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .toString()
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(TATWEEL_REGEX, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Prepares FTS5 query with prefix matching
 */
export function prepareFtsQuery(query: string): string {
  const normalized = normalizeArabic(query);
  if (!normalized) return '';

  const words = normalized
    .replace(/["'*^:]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return '';

  return words.map((w) => `"${w}"*`).join(' AND ');
}
