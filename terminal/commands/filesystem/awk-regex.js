/**
 * If pat starts with a slash and has a closing delimiter (use backslash-slash for a literal slash in the ERE),
 * compile as a JavaScript RegExp with optional trailing flags; otherwise treat as a literal substring.
 * @param {string} pat
 * @returns {{ kind: 'literal' } | { kind: 'regex', re: RegExp } | { kind: 'bad' }}
 */
function awkParseSlashDelimitedRegex(pat) {
  const p = String(pat);
  if (p.length < 2 || p[0] !== '/') {
    return { kind: 'literal' };
  }
  let i = 1;
  let src = '';
  while (i < p.length) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) {
      const n = p[i + 1];
      if (n === '/') {
        src += '/';
        i += 2;
      } else {
        src += '\\' + n;
        i += 2;
      }
      continue;
    }
    if (c === '/') {
      const flags = p.slice(i + 1);
      try {
        const re = new RegExp(src, flags);
        return { kind: 'regex', re };
      } catch {
        return { kind: 'bad' };
      }
    }
    src += c;
    i++;
  }
  return { kind: 'literal' };
}

/**
 * gsub/sub replacement for regex mode: `&` → full match, `\\1`–`\\9` → groups,
 * `\\&` and `\\\\` escapes (GNU-like subset).
 * @param {string} repl
 * @param {unknown[]} matchArgs — replace callback args: match, groups…, offset, whole
 * @returns {string}
 */
function awkExpandRegexReplacement(repl, matchArgs) {
  const mat = matchArgs.slice(0, matchArgs.length - 2);
  const r = String(repl);
  let out = '';
  for (let j = 0; j < r.length; j++) {
    if (r[j] === '&') {
      out += mat[0];
    } else if (r[j] === '\\' && j + 1 < r.length) {
      const c = r[j + 1];
      if (c >= '1' && c <= '9') {
        const g = mat[parseInt(c, 10)];
        out += g !== undefined ? String(g) : '';
        j++;
      } else if (c === '&') {
        out += '&';
        j++;
      } else if (c === '\\') {
        out += '\\';
        j++;
      } else {
        out += c;
        j++;
      }
    } else {
      out += r[j];
    }
  }
  return out;
}

/**
 * @param {string} s
 * @param {RegExp} re
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkRegexGsubAll(s, re, repl) {
  const rg = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let count = 0;
  const result = String(s).replace(rg, (...args) => {
    count++;
    return awkExpandRegexReplacement(repl, args);
  });
  return { count, result };
}

/**
 * @param {string} s
 * @param {RegExp} re
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkRegexSubFirst(s, re, repl) {
  const r1 = new RegExp(re.source, re.flags.replace(/g/g, ''));
  const st = String(s);
  const m = r1.exec(st);
  if (!m) {
    return { count: 0, result: st };
  }
  const args = [...m, m.index, st];
  const expanded = awkExpandRegexReplacement(repl, args);
  const result = st.slice(0, m.index) + expanded + st.slice(m.index + m[0].length);
  return { count: 1, result };
}

/**
 * Global literal substring replace. Empty **PAT**: GNU **gsub** — insert **repl** before each
 * character and after the last (**count** = **s.length + 1**).
 * @param {string} s
 * @param {string} pat
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkLiteralGsubAll(s, pat, repl) {
  const str = String(s);
  const p = String(pat);
  const r = String(repl);
  if (p === '') {
    const count = str.length + 1;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += r + str[i];
    }
    out += r;
    return { count, result: out };
  }
  let count = 0;
  let out = '';
  let i = 0;
  while (i < str.length) {
    const j = str.indexOf(p, i);
    if (j < 0) {
      out += str.slice(i);
      break;
    }
    count++;
    out += str.slice(i, j) + repl;
    i = j + p.length;
  }
  return { count, result: out };
}

/**
 * First literal substring replace only. Empty **PAT**: GNU **sub** — one insertion before the first
 * character (**repl** + **s**).
 * @param {string} s
 * @param {string} pat
 * @param {string} repl
 * @returns {{ count: number, result: string }}
 */
function awkLiteralSubFirst(s, pat, repl) {
  const str = String(s);
  const p = String(pat);
  if (p === '') {
    return { count: 1, result: String(repl) + str };
  }
  const j = str.indexOf(p);
  if (j < 0) {
    return { count: 0, result: str };
  }
  return { count: 1, result: str.slice(0, j) + repl + str.slice(j + p.length) };
}

export {
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst,
  awkLiteralGsubAll,
  awkLiteralSubFirst
};
