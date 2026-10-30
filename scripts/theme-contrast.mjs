// Contrast of the Heyming OS theme. Colors come from brand.css tokens and
// from the few literal colors that file paints. A pair is checked only when
// the stylesheet sets that foreground on that background. Nothing is blended
// and nothing is invented for a page that hard-codes its own palette.

const AA_TEXT = 4.5;
const AA_UI = 3;

/**
 * @typedef {'light' | 'dark'} ThemeName
 */

/**
 * @typedef {object} ContrastPair
 * @property {ThemeName | 'both'} theme
 * @property {string} fg token name or #hex
 * @property {string} bg token name or #hex
 * @property {string} where
 * @property {number} minimum
 */

/**
 * @typedef {object} ContrastResult
 * @property {ThemeName} theme
 * @property {string} where
 * @property {string} fg
 * @property {string} bg
 * @property {string} fgHex
 * @property {string} bgHex
 * @property {number} ratio
 * @property {number} minimum
 * @property {boolean} pass
 */

/** Pairs brand.css actually paints. Token names are resolved per theme. */
export const THEME_PAIRS = [
  { theme: 'both', fg: '--text-1', bg: '--surface-0', where: '.hos-page', minimum: AA_TEXT },
  {
    theme: 'both',
    fg: '--text-1',
    bg: '--surface-1',
    where: '.surface-1, button, input',
    minimum: AA_TEXT
  },
  { theme: 'both', fg: '--text-1', bg: '--surface-2', where: '.surface-2, kbd', minimum: AA_TEXT },
  {
    theme: 'both',
    fg: '--text-2',
    bg: '--surface-0',
    where: '.text-muted, legend, tagline',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-2',
    bg: '--surface-1',
    where: '.text-muted on a card',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-2',
    bg: '--surface-2',
    where: '.text-muted on a recess',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-3',
    bg: '--surface-0',
    where: '.text-subtle, status strip',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-3',
    bg: '--surface-1',
    where: 'placeholder on an input',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-3',
    bg: '--surface-2',
    where: '.text-subtle on a recess',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--accent-blue',
    bg: '--surface-0',
    where: 'link on the page',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--accent-blue',
    bg: '--surface-1',
    where: 'link on a card',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--accent-blue',
    bg: '--surface-2',
    where: 'link on a recess',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-on-accent',
    bg: '--accent-primary-bg',
    where: 'button:active',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--accent-primary-hover',
    bg: '--accent-primary-soft',
    where: 'button:hover',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--text-1',
    bg: '--accent-primary-soft',
    where: '::selection',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--success',
    bg: '--surface-0',
    where: 'status text on the page',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--danger',
    bg: '--surface-0',
    where: 'status text on the page',
    minimum: AA_TEXT
  },
  {
    theme: 'both',
    fg: '--focus-ring-inner',
    bg: '--surface-0',
    where: ':focus-visible ring on the page',
    minimum: AA_UI
  },
  {
    theme: 'both',
    fg: '--focus-ring-inner',
    bg: '--surface-1',
    where: ':focus-visible ring on a card',
    minimum: AA_UI
  },
  {
    theme: 'light',
    fg: '#660099',
    bg: '--surface-0',
    where: 'a:visited on the page',
    minimum: AA_TEXT
  },
  {
    theme: 'light',
    fg: '#660099',
    bg: '--surface-1',
    where: 'a:visited on a card',
    minimum: AA_TEXT
  },
  {
    theme: 'light',
    fg: '--accent-primary-hover',
    bg: '#fffacd',
    where: 'a:hover',
    minimum: AA_TEXT
  },
  {
    theme: 'dark',
    fg: '#c290e8',
    bg: '--surface-0',
    where: 'a:visited on the page',
    minimum: AA_TEXT
  },
  {
    theme: 'dark',
    fg: '#c290e8',
    bg: '--surface-1',
    where: 'a:visited on a card',
    minimum: AA_TEXT
  },
  {
    theme: 'dark',
    fg: '--accent-primary-hover',
    bg: '#3a2f00',
    where: 'a:hover',
    minimum: AA_TEXT
  }
];

/**
 * @param {number} channel 0–255
 * @returns {number}
 */
function linearize(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const raw = match[1];
  const full = raw.length === 3 ? raw.replace(/([\da-f])/gi, '$1$1') : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

/**
 * @param {string} hex
 * @returns {number | null}
 */
export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

/**
 * @param {string} fg
 * @param {string} bg
 * @returns {number | null}
 */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {string} css
 * @param {number} from
 * @returns {string}
 */
function blockBody(css, from) {
  const open = css.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * @param {string} body
 * @returns {Record<string, string>}
 */
function colorDeclarations(body) {
  /** @type {Record<string, string>} */
  const tokens = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  for (const match of body.matchAll(re)) {
    const value = match[2].trim();
    if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(value) || /^var\(--[\w-]+\)$/.test(value)) {
      tokens[match[1]] = value;
    }
  }
  return tokens;
}

/**
 * @param {Record<string, string>} tokens
 * @returns {Record<string, string>}
 */
function resolveTokens(tokens) {
  /** @type {Record<string, string>} */
  const resolved = { ...tokens };
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [name, value] of Object.entries(resolved)) {
      const ref = /^var\((--[\w-]+)\)$/.exec(value);
      if (!ref) continue;
      const next = resolved[ref[1]];
      if (next && !next.startsWith('var(')) {
        resolved[name] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return resolved;
}

/**
 * @param {string} css
 * @returns {{ light: Record<string, string>, dark: Record<string, string>, darkMedia: Record<string, string> }}
 */
export function themeTokens(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const lightAt = source.indexOf(':root {');
  const darkAt = source.indexOf(":root[data-theme='dark']");
  const mediaAt = source.indexOf(":root:not([data-theme='light'])");
  const light = colorDeclarations(blockBody(source, lightAt));
  const dark = colorDeclarations(blockBody(source, darkAt));
  const darkMedia = colorDeclarations(blockBody(source, mediaAt));
  return {
    light: resolveTokens(light),
    // Each dark path layers over :root. A var() alias declared only on
    // :root still resolves to the dark literal it points at.
    dark: resolveTokens({ ...light, ...dark }),
    darkMedia: resolveTokens({ ...light, ...darkMedia })
  };
}

/**
 * @param {Record<string, string>} tokens
 * @param {string} color token name or #hex
 * @returns {string | null}
 */
function lookup(tokens, color) {
  if (color.startsWith('#')) return parseHex(color) ? color.toLowerCase() : null;
  const value = tokens[color];
  return value && parseHex(value) ? value.toLowerCase() : null;
}

/**
 * @param {string} css
 * @returns {{ results: ContrastResult[], drift: string[] }}
 */
export function auditThemeContrast(css) {
  const themes = themeTokens(css);
  /** @type {string[]} */
  const drift = [];
  const names = new Set([...Object.keys(themes.dark), ...Object.keys(themes.darkMedia)]);
  for (const name of names) {
    if (themes.dark[name] !== themes.darkMedia[name]) {
      drift.push(
        `${name} is ${themes.dark[name] || 'missing'} in data-theme=dark and ${
          themes.darkMedia[name] || 'missing'
        } under prefers-color-scheme`
      );
    }
  }
  /** @type {ContrastResult[]} */
  const results = [];
  for (const pair of THEME_PAIRS) {
    const which = pair.theme === 'both' ? ['light', 'dark'] : [pair.theme];
    for (const theme of which) {
      const tokens = theme === 'light' ? themes.light : themes.dark;
      const fgHex = lookup(tokens, pair.fg);
      const bgHex = lookup(tokens, pair.bg);
      const ratio = fgHex && bgHex ? contrastRatio(fgHex, bgHex) : null;
      results.push({
        theme,
        where: pair.where,
        fg: pair.fg,
        bg: pair.bg,
        fgHex: fgHex || '',
        bgHex: bgHex || '',
        ratio: ratio === null ? 0 : Math.round(ratio * 100) / 100,
        minimum: pair.minimum,
        pass: ratio !== null && ratio + 1e-9 >= pair.minimum
      });
    }
  }
  return { results, drift };
}
