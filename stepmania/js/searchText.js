/**
 * Lowercase, drop apostrophes, collapse whitespace. "dont stop" matches "Don't Stop".
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/['’ʼ`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {unknown} name
 * @param {unknown} query
 * @returns {boolean}
 */
export function matchesSearchText(name, query) {
  return normalizeSearchText(name).includes(normalizeSearchText(query));
}
