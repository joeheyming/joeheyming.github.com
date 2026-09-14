/**
 * MSD (`#TAG:value;`) tokenizer used by .sm / .ssc simfiles.
 */

/**
 * Strip `//` line comments and `/* *\/` block comments.
 * @param {string} content
 */
export function stripSimfileComments(content) {
  return String(content || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * @typedef {{ tag: string, value: string }} MsdTag
 */

/**
 * @param {string} content
 * @returns {MsdTag[]}
 */
export function parseMsd(content) {
  const text = stripSimfileComments(content);
  /** @type {MsdTag[]} */
  const tags = [];
  let i = 0;
  while (i < text.length) {
    const hash = text.indexOf('#', i);
    if (hash === -1) break;
    const colon = text.indexOf(':', hash + 1);
    if (colon === -1) break;
    const tag = text
      .slice(hash + 1, colon)
      .trim()
      .toUpperCase();
    const semi = text.indexOf(';', colon + 1);
    if (semi === -1) break;
    if (!tag) {
      i = colon + 1;
      continue;
    }
    tags.push({ tag, value: text.slice(colon + 1, semi).trim() });
    i = semi + 1;
  }
  return tags;
}

/**
 * Parse `beat=value,beat=value` lists. Zero values are dropped (SM loader).
 * @param {string} value
 * @returns {Array<{beat: number, value: number}>}
 */
export function parseTimingPairs(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(',')
    .map((pair) => {
      const [beatRaw, valueRaw] = pair.split('=');
      return { beat: parseFloat(beatRaw), value: parseFloat(valueRaw) };
    })
    .filter(
      (pair) => Number.isFinite(pair.beat) && Number.isFinite(pair.value) && pair.value !== 0
    );
}

/**
 * @param {Array<{beat: number, value: number}>} pairs
 */
export function formatTimingPairs(pairs) {
  return (pairs || [])
    .filter((p) => Number.isFinite(p.beat) && Number.isFinite(p.value))
    .map((p) => `${p.beat.toFixed(3)}=${p.value.toFixed(3)}`)
    .join(',');
}

/**
 * Split a legacy `#NOTES:` value into the six SM fields.
 * @param {string} value
 * @returns {string[]}
 */
export function splitSmNotesValue(value) {
  const parts = [];
  let current = '';
  let colons = 0;
  for (const ch of String(value || '')) {
    if (ch === ':' && colons < 5) {
      parts.push(current.trim());
      current = '';
      colons += 1;
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  while (parts.length < 6) parts.push('');
  return parts;
}
