/**
 * Advance past a single- or double-quoted awk string starting at `i` (index of opening quote).
 * @param {string} s
 * @param {number} i
 * @returns {number} index just after closing quote or **s.length** if unterminated
 */
function awkSkipQuotedString(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'") {
    return i;
  }
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\' && j + 1 < s.length) {
      j += 2;
      continue;
    }
    if (s[j] === q) {
      return j + 1;
    }
    j++;
  }
  return s.length;
}

/**
 * Index of the `)` matching the `(` at **openIdx**, respecting quotes.
 * @param {string} s
 * @param {number} openIdx
 * @returns {number} closing index, or **-1**
 */
function awkFindMatchingParen(s, openIdx) {
  let depth = 1;
  let j = openIdx + 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = awkSkipQuotedString(s, j);
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    }
    j++;
  }
  if (depth !== 0) {
    return -1;
  }
  return j - 1;
}

/**
 * Index of the `]` matching the `[` at **openIdx**, respecting quotes.
 * @param {string} s
 * @param {number} openIdx
 * @returns {number} closing index, or **-1**
 */
function awkFindMatchingBracket(s, openIdx) {
  if (s[openIdx] !== '[') {
    return -1;
  }
  let depth = 1;
  let j = openIdx + 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '"' || c === "'") {
      j = awkSkipQuotedString(s, j);
      continue;
    }
    if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
    }
    j++;
  }
  if (depth !== 0) {
    return -1;
  }
  return j - 1;
}

/**
 * Parse **name[EXPR]** as a whole expression (balanced **]**); **EXPR** is evaluated for the key.
 * @param {string} expr
 * @returns {{ name: string, inner: string } | null}
 */
function awkParseArrayAccess(expr) {
  const t = expr.trim();
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(t);
  if (!m) {
    return null;
  }
  const name = m[1];
  const openIdx = m.index + m[0].length - 1;
  if (t[openIdx] !== '[') {
    return null;
  }
  const closeIdx = awkFindMatchingBracket(t, openIdx);
  if (closeIdx < 0 || closeIdx !== t.length - 1) {
    return null;
  }
  const inner = t.slice(openIdx + 1, closeIdx).trim();
  return { name, inner };
}

/**
 * Parse **length**, **length()**, or **length(EXPR)** at the start of an expression.
 * @param {string} expr
 * @returns {{ ok: true, inner: string | null } | { ok: false }}
 */
function awkParseLengthCall(expr) {
  const t = expr.trim();
  if (t === 'length') {
    return { ok: true, inner: null };
  }
  if (!t.startsWith('length')) {
    return { ok: false };
  }
  let i = 6;
  while (i < t.length && /\s/.test(t[i])) {
    i++;
  }
  if (i >= t.length || t[i] !== '(') {
    return { ok: false };
  }
  const closeIdx = awkFindMatchingParen(t, i);
  if (closeIdx < 0) {
    return { ok: false };
  }
  const inner = t.slice(i + 1, closeIdx).trim();
  const rest = t.slice(closeIdx + 1).trim();
  if (rest !== '') {
    return { ok: false };
  }
  return { ok: true, inner: inner === '' ? null : inner };
}

function awkParseNamedCall(expr, name) {
  const t = expr.trim();
  if (!t.startsWith(name)) {
    return null;
  }
  let i = name.length;
  if (i < t.length && !/\s/.test(t[i]) && t[i] !== '(') {
    return null;
  }
  while (i < t.length && /\s/.test(t[i])) {
    i++;
  }
  if (i >= t.length || t[i] !== '(') {
    return null;
  }
  const closeIdx = awkFindMatchingParen(t, i);
  if (closeIdx < 0) {
    return null;
  }
  const inner = t.slice(i + 1, closeIdx).trim();
  const rest = t.slice(closeIdx + 1).trim();
  if (rest !== '') {
    return null;
  }
  return inner;
}

export {
  awkSkipQuotedString,
  awkFindMatchingParen,
  awkFindMatchingBracket,
  awkParseArrayAccess,
  awkParseLengthCall,
  awkParseNamedCall
};
