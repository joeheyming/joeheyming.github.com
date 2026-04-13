const AWK_HELP = `Usage: awk [POSIX or GNU-style options]... 'program' [FILE]...
Pattern scanning and processing language (jsh subset).

  -F SEP, --field-separator=SEP   use SEP as field separator (default: whitespace)
  -h, --help                       display this help and exit
      --                           end of options

jsh:
  **program** may include optional **BEGIN {print ...}**, optional **{print ...}**,
  optional **END {print ...}** (that order). Each EXPR is **$0**, **$N**, **NR**,
  **NF**, **RSTART**, **RLENGTH**, a quoted string, **length** / **length()** / **length(EXPR)**,
  **substr(S, I [, L])** (1-based **I**, optional length **L**; **I** before **1** is
  treated as **1** like GNU awk),   **index(S, T)** (1-based start of first **T** in **S**,
  or **0**), **match(S, P [, ARRAY])** (literal substring **P** in **S** unless **P** is **slash-delimited**
  **/ERE/flags** — then **JavaScript RegExp**; sets **RSTART** / **RLENGTH**; returns start index or **0**;
  optional third arg must be an identifier — clears and fills **ARRAY[0]** (full match), **ARRAY[1]**… (regex
  capture groups only); read back with **ARRAY[EXPR]** — **EXPR** may be a number, **$N**, or nested **ARRAY[…]**),
  **split(STRING, ARRAY [, SEP])** (fills **ARRAY[1]**…; **SEP** defaults to current **-F** FS; returns field count),
  **gsub(PAT, REP [, $N])** / **sub(...)** (literal **PAT** unless **/ERE/flags**; mutates **$0** or **$N**;
  returns substitution count; in **regex** mode **REP** expands **&** to the match and **\\1**–**\\9** to groups). Arithmetic: **+**, **-**, ${'*'}, **/**, **%**, **^** (exponentiation is
  right-associative, e.g. **2^3^2** → **512**; **^** binds before unary **-**, so **-2^2** → **-4**),
  unary **-**, parentheses; operands are numeric literals, **$N**, **NR**, **NF**,
  **RSTART**, **RLENGTH**, quoted strings (coerced like awk), and **length(...)**. **print** with no expressions prints **$0**. **BEGIN** sees **NR=0**,
  **NF=0**, **$0** empty. **END** sees the last record (**NR=0** if no input). Default
  field splitting matches runs of whitespace; **-F** uses a literal separator string
  (often one character). **/ERE/** uses **JavaScript** syntax (not full POSIX ERE); invalid patterns fail the **print** expression. No patterns, user variables, or **-f** script files.
  **gsub** with empty **PAT**: GNU-style — inserts **REP** at each of **length($N)+1** positions (before
  each character and after the last). **sub** with empty **PAT**: one insertion before the first character only.

Full documentation: <https://www.gnu.org/software/gawk/manual/html_node/Getting-Started.html>
`;

/**
 * GNU-style option error for awk (exit status 2).
 * @param {string} arg
 * @returns {string}
 */
function awkOptionError(arg) {
  const tryLine = "Try 'awk --help' for more information.\n";
  if (arg.startsWith('--') && arg.length > 2) {
    return `awk: unrecognized option '${arg}'\n${tryLine}`;
  }
  if (arg.startsWith('-') && arg.length === 2) {
    return `awk: invalid option -- '${arg[1]}'\n${tryLine}`;
  }
  return `awk: unrecognized option '${arg}'\n${tryLine}`;
}

/**
 * Parse jsh `awk` argv: -F/--field-separator, --help/-h, --, program, FILEs.
 *
 * @param {string[]} args
 * @returns {{ ok: true, fieldSeparator: string, program: string, fileOperands: string[], help?: true } | { ok: false, stderr: string, exitCode: number }}
 */
function parseAwkArgv(args) {
  const argsArr = Array.isArray(args) ? args : [];
  let fieldSeparator = ' ';
  let i = 0;
  while (i < argsArr.length) {
    const arg = argsArr[i];
    if (arg === '--') {
      const rest = argsArr.slice(i + 1);
      if (rest.length === 0) {
        return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
      }
      return {
        ok: true,
        fieldSeparator,
        program: rest[0],
        fileOperands: rest.slice(1)
      };
    }
    if (arg === '--help' || arg === '-h') {
      return { ok: true, help: true, fieldSeparator, program: '', fileOperands: [] };
    }
    if (arg === '-F' || arg === '--field-separator') {
      if (i + 1 >= argsArr.length) {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'F'\n",
          exitCode: 2
        };
      }
      fieldSeparator = argsArr[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith('--field-separator=')) {
      const rest = arg.slice('--field-separator='.length);
      if (rest === '') {
        return {
          ok: false,
          stderr: "awk: option requires an argument -- 'field-separator'\n",
          exitCode: 2
        };
      }
      fieldSeparator = rest;
      i++;
      continue;
    }
    if (arg.startsWith('-F') && arg.length > 2) {
      fieldSeparator = arg.slice(2);
      i++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    if (arg.startsWith('--') && arg.length > 2) {
      return { ok: false, stderr: awkOptionError(arg), exitCode: 2 };
    }
    return {
      ok: true,
      fieldSeparator,
      program: arg,
      fileOperands: argsArr.slice(i + 1)
    };
  }
  return { ok: false, stderr: 'awk: missing program\n', exitCode: 2 };
}

/**
 * Split awk default (whitespace) fields — $0 preserved separately.
 * @param {string} line
 * @returns {string[]}
 */
function awkSplitFieldsDefault(line) {
  const m = line.match(/[^\s]+/g);
  return m || [];
}

/**
 * @param {string} line
 * @param {string} fs — ' ' means default whitespace; otherwise literal split string
 * @returns {string[]}
 */
function awkSplitFields(line, fs) {
  if (fs === ' ') {
    return awkSplitFieldsDefault(line);
  }
  return line.split(fs);
}

/**
 * Split at top-level commas (respects quotes and **(...)** nesting). Used for
 * **`print` arg lists** and for function-call argument lists (**`substr`**, **`index`**).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitCommaListTopLevel(s) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let i = 0;
  const str = String(s);
  while (i < str.length) {
    const c = str[i];
    if (c === '"' || c === "'") {
      const end = awkSkipQuotedString(str, i);
      cur += str.slice(i, end);
      i = end;
      continue;
    }
    if (c === '(') {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ')') {
      depth--;
      cur += c;
      i++;
      continue;
    }
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Split comma-separated print arguments respecting quotes and parentheses.
 * @param {string} s
 * @returns {{ ok: true, parts: string[] }}
 */
function awkSplitPrintArgs(s) {
  const parts = awkSplitCommaListTopLevel(String(s))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return { ok: true, parts };
}

/**
 * Parse inner of `{ ... }` as `print EXPR,...` (jsh subset).
 * @param {string} body
 * @returns {{ ok: true, exprs: string[] } | { ok: false, stderr: string }}
 */
function parseAwkPrintBlockBody(body) {
  const trimmed = String(body).trim();
  const m = /^\s*print\s*(.*)\s*$/s.exec(trimmed);
  if (!m) {
    return { ok: false, stderr: 'awk: jsh only supports {print ...} blocks\n' };
  }
  const inner = m[1].trim();
  if (inner === '') {
    return { ok: true, exprs: ['$0'] };
  }
  const sp = awkSplitPrintArgs(inner);
  if (sp.parts.length === 0) {
    return { ok: true, exprs: ['$0'] };
  }
  return { ok: true, exprs: sp.parts };
}

/**
 * Extract `{ ... }` starting at the first character of `s` (must be `{`).
 * Respects single/double-quoted strings and `\\` escapes inside quotes.
 * @param {string} s
 * @returns {{ inner: string, rest: string } | null}
 */
function extractAwkBraceBlock(s) {
  const t = String(s).trimStart();
  if (t[0] !== '{') {
    return null;
  }
  let depth = 1;
  let i = 1;
  let inQuote = '';
  while (i < t.length && depth > 0) {
    const c = t[i];
    if (inQuote) {
      if (c === inQuote) {
        inQuote = '';
      } else if (c === '\\' && i + 1 < t.length) {
        i++;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      i++;
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    }
    i++;
  }
  if (depth !== 0) {
    return null;
  }
  const inner = t.slice(1, i - 1);
  return { inner: inner.trim(), rest: t.slice(i) };
}

/**
 * Parse optional BEGIN / main / END `{print ...}` blocks (jsh subset).
 * @param {string} program
 * @returns {{ ok: true, beginExprs: string[] | null, mainExprs: string[] | null, endExprs: string[] | null } | { ok: false, stderr: string }}
 */
function parseAwkFullProgram(program) {
  let s = String(program).trim();
  let beginExprs = null;
  let mainExprs = null;
  let endExprs = null;

  if (s.startsWith('BEGIN')) {
    s = s.slice(5).trimStart();
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: missing { after BEGIN\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (pb.ok === false) {
      return pb;
    }
    beginExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.startsWith('{')) {
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: unmatched {\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (pb.ok === false) {
      return pb;
    }
    mainExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.startsWith('END')) {
    s = s.slice(3).trimStart();
    const br = extractAwkBraceBlock(s);
    if (!br) {
      return { ok: false, stderr: 'awk: missing { after END\n' };
    }
    const pb = parseAwkPrintBlockBody(br.inner);
    if (pb.ok === false) {
      return pb;
    }
    endExprs = pb.exprs;
    s = br.rest.trimStart();
  }

  if (s.length > 0) {
    return { ok: false, stderr: 'awk: jsh: unexpected trailing program text\n' };
  }

  if (beginExprs === null && mainExprs === null && endExprs === null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports BEGIN ... {print ...} END ...\n'
    };
  }

  return { ok: true, beginExprs, mainExprs, endExprs };
}

/**
 * Parse `{print ...}` body (jsh subset).
 * @param {string} program
 * @returns {{ ok: true, exprs: string[] } | { ok: false, stderr: string }}
 */
function parseAwkPrintProgram(program) {
  const fp = parseAwkFullProgram(program);
  if (fp.ok === false) {
    return fp;
  }
  if (fp.beginExprs !== null || fp.endExprs !== null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports a single {print ...} program\n'
    };
  }
  if (fp.mainExprs === null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports a single {print ...} program\n'
    };
  }
  return { ok: true, exprs: fp.mainExprs };
}

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

/**
 * Split **inner** of a function call at top-level commas (same rules as **`print`** lists).
 * @param {string} s
 * @returns {string[]}
 */
function awkSplitTopLevelCommas(s) {
  return awkSplitCommaListTopLevel(s);
}

/**
 * Parse **name(...)** at the start of **expr** (whole expression only).
 * @param {string} expr
 * @param {string} name
 * @returns {string | null} inner between parentheses
 */
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

/**
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalSubstrExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const startV = awkEvalPrintExpr(parts[1], ctx);
  if (startV === null) {
    return null;
  }
  const s = String(strV);
  let start = Number(startV);
  if (!Number.isFinite(start)) {
    start = 0;
  }
  start = Math.floor(start);
  if (start < 1) {
    start = 1;
  }
  if (start > s.length) {
    return '';
  }
  const i0 = start - 1;
  if (parts.length === 2) {
    return s.slice(i0);
  }
  const lenV = awkEvalPrintExpr(parts[2], ctx);
  if (lenV === null) {
    return null;
  }
  let len = Number(lenV);
  if (!Number.isFinite(len)) {
    len = 0;
  }
  len = Math.floor(len);
  if (len < 0) {
    len = 0;
  }
  return s.slice(i0, i0 + len);
}

/**
 * @param {string} inner — comma-separated args (**S**, **T**)
 * @param {{ $0: string, fields: string[], NR: number, NF: number }} ctx
 * @returns {string | null}
 */
function awkEvalIndexExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2) {
    return null;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  if (a === null) {
    return null;
  }
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (b === null) {
    return null;
  }
  const s = String(a);
  const t = String(b);
  if (t === '') {
    return '1';
  }
  const idx = s.indexOf(t);
  if (idx < 0) {
    return '0';
  }
  return String(idx + 1);
}

/**
 * **split(STRING, ARRAY [, SEP])** — GNU-like: fills **ARRAY[1]**… with fields; returns field count as string.
 * **SEP** omitted uses current **-F** field separator (whitespace when **FS** is space).
 * @param {string} inner — comma-separated args
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalSplitExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const strV = awkEvalPrintExpr(parts[0], ctx);
  if (strV === null) {
    return null;
  }
  const arrTok = parts[1].trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(arrTok)) {
    return null;
  }
  let fs = ctx.fieldSeparator !== undefined ? ctx.fieldSeparator : ' ';
  if (parts.length === 3) {
    const sepV = awkEvalPrintExpr(parts[2], ctx);
    if (sepV === null) {
      return null;
    }
    fs = String(sepV);
  }
  if (!ctx.awkArrays) {
    ctx.awkArrays = Object.create(null);
  }
  let store = ctx.awkArrays[arrTok];
  if (!store) {
    store = Object.create(null);
    ctx.awkArrays[arrTok] = store;
  } else {
    for (const k of Object.keys(store)) {
      delete store[k];
    }
  }
  const fields = awkSplitFields(String(strV), fs === ' ' ? ' ' : fs);
  for (let i = 0; i < fields.length; i++) {
    store[String(i + 1)] = fields[i];
  }
  return String(fields.length);
}

/**
 * Rebuild **$0** from **fields** using the same separator as **-F** (GNU **OFS**-like for jsh).
 * @param {string[]} fields
 * @param {string} ofs
 * @returns {string}
 */
function awkRebuild0FromFields(fields, ofs) {
  if (ofs === ' ') {
    return fields.join(' ');
  }
  return fields.join(ofs);
}

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
 * @param {any[]} matchArgs — replace callback args: match, groups…, offset, whole
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

/**
 * gsub and sub: literal pattern and replacement; optional third arg is $0…$N (default $0).
 * Mutates **ctx** (and returns substitution count as a string).
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator?: string }} ctx
 * @param {boolean} global
 * @returns {string | null}
 */
function awkEvalGsubExpr(inner, ctx, global) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  const patV = awkEvalPrintExpr(parts[0], ctx);
  const replV = awkEvalPrintExpr(parts[1], ctx);
  if (patV === null || replV === null) {
    return null;
  }
  const pat = String(patV);
  const repl = String(replV);
  const mode = awkParseSlashDelimitedRegex(pat);
  if (mode.kind === 'bad') {
    return null;
  }
  let targetN = 0;
  if (parts.length === 3) {
    const t3 = parts[2].trim();
    const m = /^\$(\d+)$/.exec(t3);
    if (!m) {
      return null;
    }
    targetN = parseInt(m[1], 10);
  }
  const fs = ctx.fieldSeparator === undefined ? ' ' : ctx.fieldSeparator;
  const apply = (fieldStr) => {
    if (mode.kind === 'regex') {
      return global
        ? awkRegexGsubAll(fieldStr, mode.re, repl)
        : awkRegexSubFirst(fieldStr, mode.re, repl);
    }
    const replacer = global ? awkLiteralGsubAll : awkLiteralSubFirst;
    return replacer(fieldStr, pat, repl);
  };
  if (targetN === 0) {
    const r = apply(ctx.$0);
    ctx.$0 = r.result;
    ctx.fields = awkSplitFields(ctx.$0, fs);
    ctx.NF = ctx.fields.length;
    return String(r.count);
  }
  const idx = targetN - 1;
  if (idx < 0) {
    return null;
  }
  while (ctx.fields.length <= idx) {
    ctx.fields.push('');
  }
  const fieldStr = ctx.fields[idx] !== undefined ? String(ctx.fields[idx]) : '';
  const r = apply(fieldStr);
  ctx.fields[idx] = r.result;
  ctx.$0 = awkRebuild0FromFields(ctx.fields, fs);
  ctx.NF = ctx.fields.length;
  return String(r.count);
}

/**
 * match(S, P [, ARRAY]): literal substring P in S, or slash-delimited ERE with optional flags (JavaScript RegExp);
 * sets RSTART and RLENGTH (GNU-like); optional third arg clears and fills **ctx.awkArrays[ARRAY]**.
 * @param {string} inner
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalMatchExpr(inner, ctx) {
  const parts = awkSplitTopLevelCommas(inner);
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }
  let arrayName = null;
  if (parts.length === 3) {
    const t = parts[2].trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      return null;
    }
    arrayName = t;
  }
  const a = awkEvalPrintExpr(parts[0], ctx);
  const b = awkEvalPrintExpr(parts[1], ctx);
  if (a === null || b === null) {
    return null;
  }
  const s = String(a);
  const p = String(b);
  const applyArray = (/** @type {RegExpExecArray | null} */ execResult, literalSlice) => {
    if (!arrayName) {
      return;
    }
    if (!ctx.awkArrays) {
      ctx.awkArrays = Object.create(null);
    }
    const store = Object.create(null);
    ctx.awkArrays[arrayName] = store;
    if (execResult) {
      for (let i = 0; i < execResult.length; i++) {
        if (execResult[i] !== undefined) {
          store[String(i)] = String(execResult[i]);
        }
      }
      return;
    }
    if (literalSlice !== null && literalSlice !== undefined) {
      store['0'] = String(literalSlice);
    }
  };
  if (p === '') {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  const mode = awkParseSlashDelimitedRegex(p);
  if (mode.kind === 'bad') {
    return null;
  }
  if (mode.kind === 'regex') {
    const re = new RegExp(mode.re.source, mode.re.flags.replace(/g/g, ''));
    const m = re.exec(s);
    if (!m) {
      ctx.RSTART = 0;
      ctx.RLENGTH = -1;
      applyArray(null, null);
      return '0';
    }
    ctx.RSTART = m.index + 1;
    ctx.RLENGTH = m[0].length;
    applyArray(m, null);
    return String(m.index + 1);
  }
  const idx = s.indexOf(p);
  if (idx < 0) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    applyArray(null, null);
    return '0';
  }
  ctx.RSTART = idx + 1;
  ctx.RLENGTH = p.length;
  applyArray(null, s.slice(idx, idx + p.length));
  return String(idx + 1);
}

/**
 * Coerce a string to a number (GNU awk–like for jsh: **parseFloat** leading portion, **''** → **0**).
 * @param {string} s
 * @returns {number}
 */
function awkStrToNum(s) {
  const t = String(s).trim();
  if (t === '') {
    return 0;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format an arithmetic result for **print** output (integers without trailing **.0** when exact).
 * @param {number} n
 * @returns {string}
 */
function awkFormatArithResult(n) {
  if (Number.isNaN(n)) {
    return 'nan';
  }
  if (n === Infinity) {
    return 'inf';
  }
  if (n === -Infinity) {
    return '-inf';
  }
  if (Math.abs(n) < 1e15 && Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return String(n);
}

/**
 * Recursive-descent parser for +, -, *, /, %, ^ (right-assoc), unary -, parentheses,
 * and awk primaries inside print expressions (jsh subset).
 */
class AwkArithParser {
  /**
   * @param {string} str
   * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
   */
  constructor(str, ctx) {
    this.s = str;
    this.i = 0;
    this.ctx = ctx;
  }

  skipSpaces() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) {
      this.i++;
    }
  }

  peek() {
    return this.i < this.s.length ? this.s[this.i] : '';
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '+') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left += right;
      } else if (c === '-') {
        this.i++;
        const right = this.parseMulDiv();
        if (right === null) {
          return null;
        }
        left -= right;
      } else {
        break;
      }
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnaryExpr();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      const op = this.peek();
      if (op === '*') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left *= right;
      } else if (op === '/') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        left /= right;
      } else if (op === '%') {
        this.i++;
        const right = this.parseUnaryExpr();
        if (right === null) {
          return null;
        }
        if (right === 0) {
          return null;
        }
        left %= right;
      } else {
        break;
      }
    }
    return left;
  }

  /**
   * Unary plus/minus binds looser than caret (GNU awk: -2^2 is -(2^2)).
   * Non-unary path parses exponentiation / postfix.
   */
  parseUnaryExpr() {
    this.skipSpaces();
    if (this.peek() === '+') {
      this.i++;
      return this.parseUnaryExpr();
    }
    if (this.peek() === '-') {
      this.i++;
      const u = this.parseUnaryExpr();
      return u === null ? null : -u;
    }
    return this.parsePowExpr();
  }

  /** **^** is right-associative; exponent may start with unary (**2^-2**). */
  parsePowExpr() {
    let left = this.parsePrimary();
    if (left === null) {
      return null;
    }
    for (;;) {
      this.skipSpaces();
      if (this.peek() !== '^') {
        break;
      }
      this.i++;
      const right = this.parseUnaryExpr();
      if (right === null) {
        return null;
      }
      left = Math.pow(left, right);
    }
    return left;
  }

  parsePrimary() {
    this.skipSpaces();
    const c = this.peek();
    if (c === '') {
      return null;
    }
    if (c === '(') {
      this.i++;
      const inner = this.parseAddSub();
      if (inner === null) {
        return null;
      }
      this.skipSpaces();
      if (this.peek() !== ')') {
        return null;
      }
      this.i++;
      return inner;
    }
    if (c === '"' || c === "'") {
      const q = c;
      const end = awkSkipQuotedString(this.s, this.i);
      if (end <= this.i + 1 || this.s[end - 1] !== q) {
        return null;
      }
      const inner = this.s.slice(this.i + 1, end - 1);
      this.i = end;
      return awkStrToNum(inner);
    }
    if (c === '$') {
      this.i++;
      this.skipSpaces();
      const m = /^\d+/.exec(this.s.slice(this.i));
      if (!m) {
        return null;
      }
      this.i += m[0].length;
      const n = parseInt(m[0], 10);
      const fv = this.ctx.fields[n - 1];
      return awkStrToNum(fv !== undefined ? fv : '');
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NR' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NR));
    }
    if (
      this.s.slice(this.i, this.i + 2) === 'NF' &&
      (this.i + 2 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 2]))
    ) {
      this.i += 2;
      return awkStrToNum(String(this.ctx.NF));
    }
    if (
      this.s.slice(this.i).startsWith('RSTART') &&
      (this.i + 6 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 6]))
    ) {
      this.i += 6;
      return awkStrToNum(String(this.ctx.RSTART !== undefined ? this.ctx.RSTART : 0));
    }
    if (
      this.s.slice(this.i).startsWith('RLENGTH') &&
      (this.i + 7 >= this.s.length || !/[A-Za-z0-9_]/.test(this.s[this.i + 7]))
    ) {
      this.i += 7;
      return awkStrToNum(String(this.ctx.RLENGTH !== undefined ? this.ctx.RLENGTH : -1));
    }
    {
      const rest = this.s.slice(this.i);
      const mArr = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[/.exec(rest);
      if (mArr) {
        const openIdx = this.i + mArr[0].length - 1;
        const closeIdx = awkFindMatchingBracket(this.s, openIdx);
        if (closeIdx >= 0) {
          const full = this.s.slice(this.i, closeIdx + 1);
          const acc = awkParseArrayAccess(full);
          if (acc) {
            const v = awkEvalPrintExpr(full, this.ctx);
            if (v === null) {
              return null;
            }
            this.i = closeIdx + 1;
            return awkStrToNum(v);
          }
        }
      }
    }
    if (this.s.slice(this.i).startsWith('length')) {
      let k = this.i + 6;
      while (k < this.s.length && /\s/.test(this.s[k])) {
        k++;
      }
      if (k >= this.s.length || this.s[k] !== '(') {
        return null;
      }
      const closeIdx = awkFindMatchingParen(this.s, k);
      if (closeIdx < 0) {
        return null;
      }
      const inner = this.s.slice(k + 1, closeIdx).trim();
      this.i = closeIdx + 1;
      if (inner === '') {
        return String(this.ctx.$0).length;
      }
      const v = awkEvalPrintExpr(inner, this.ctx);
      if (v === null) {
        return null;
      }
      return String(v).length;
    }
    const rest = this.s.slice(this.i);
    const numRe = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/;
    const nm = numRe.exec(rest);
    if (nm) {
      const n = parseFloat(nm[0]);
      if (!Number.isFinite(n)) {
        return null;
      }
      this.i += nm[0].length;
      return n;
    }
    return null;
  }
}

/**
 * Evaluate a full-string arithmetic expression for awk **print** (returns **null** if invalid).
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {number | null}
 */
function awkEvalArithmeticExpr(expr, ctx) {
  const p = new AwkArithParser(expr, ctx);
  const v = p.parseAddSub();
  if (v === null) {
    return null;
  }
  p.skipSpaces();
  if (p.i !== p.s.length) {
    return null;
  }
  return v;
}

/**
 * @param {string} expr
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {string | null}
 */
function awkEvalPrintExpr(expr, ctx) {
  const e = expr.trim();
  const lc = awkParseLengthCall(e);
  if (lc.ok) {
    if (lc.inner === null) {
      return String(String(ctx.$0).length);
    }
    const v = awkEvalPrintExpr(lc.inner, ctx);
    if (v === null) {
      return null;
    }
    return String(String(v).length);
  }
  const subInner = awkParseNamedCall(e, 'substr');
  if (subInner !== null) {
    return awkEvalSubstrExpr(subInner, ctx);
  }
  const idxInner = awkParseNamedCall(e, 'index');
  if (idxInner !== null) {
    return awkEvalIndexExpr(idxInner, ctx);
  }
  const gsubInner = awkParseNamedCall(e, 'gsub');
  if (gsubInner !== null) {
    return awkEvalGsubExpr(gsubInner, ctx, true);
  }
  const subOnlyInner = awkParseNamedCall(e, 'sub');
  if (subOnlyInner !== null) {
    return awkEvalGsubExpr(subOnlyInner, ctx, false);
  }
  const matchInner = awkParseNamedCall(e, 'match');
  if (matchInner !== null) {
    return awkEvalMatchExpr(matchInner, ctx);
  }
  const splitInner = awkParseNamedCall(e, 'split');
  if (splitInner !== null) {
    return awkEvalSplitExpr(splitInner, ctx);
  }
  const arrAcc = awkParseArrayAccess(e);
  if (arrAcc) {
    const keyV = awkEvalPrintExpr(arrAcc.inner, ctx);
    if (keyV === null) {
      return null;
    }
    const store = ctx.awkArrays && ctx.awkArrays[arrAcc.name];
    if (!store) {
      return '';
    }
    const k = String(keyV);
    const v = store[k];
    return v !== undefined ? String(v) : '';
  }
  if (e === '$0') {
    return ctx.$0;
  }
  if (e === 'NR') {
    return String(ctx.NR);
  }
  if (e === 'NF') {
    return String(ctx.NF);
  }
  if (e === 'RSTART') {
    return String(ctx.RSTART !== undefined ? ctx.RSTART : 0);
  }
  if (e === 'RLENGTH') {
    return String(ctx.RLENGTH !== undefined ? ctx.RLENGTH : -1);
  }
  const m = /^\$(\d+)$/.exec(e);
  if (m) {
    const n = parseInt(m[1], 10);
    const v = ctx.fields[n - 1];
    return v !== undefined ? v : '';
  }
  if (e.length >= 2) {
    const q = e[0];
    if ((q === '"' || q === "'") && e[e.length - 1] === q) {
      return e.slice(1, -1);
    }
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(e)) {
    return e;
  }
  const ar = awkEvalArithmeticExpr(e, ctx);
  if (ar !== null) {
    return awkFormatArithResult(ar);
  }
  return null;
}

/**
 * Split input into awk records (lines). Trailing newline does not add an extra empty record.
 * @param {string} text
 * @returns {string[]}
 */
function awkSplitRecordLines(text) {
  const raw = String(text);
  if (raw === '') {
    return [];
  }
  const lines = raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Awk BEGIN context (NR, NF, $0 before any input).
 * @param {string} [fieldSeparator]
 * @param {Record<string, Record<string, string>>} [awkArrays] - shared **match(..., ..., arr)** store across BEGIN / records / END
 * @returns {{ $0: string, fields: string[], NR: number, NF: number, fieldSeparator: string, RSTART: number, RLENGTH: number, awkArrays: Record<string, Record<string, string>> }}
 */
function awkBeginCtx(fieldSeparator, awkArrays) {
  const fs = fieldSeparator === undefined ? ' ' : fieldSeparator;
  return {
    $0: '',
    fields: [],
    NR: 0,
    NF: 0,
    fieldSeparator: fs,
    RSTART: 0,
    RLENGTH: -1,
    awkArrays: awkArrays === undefined ? Object.create(null) : awkArrays
  };
}

/**
 * Evaluate one `print` (single output line with trailing newline).
 * @param {string[]} exprs
 * @param {{ $0: string, fields: string[], NR: number, NF: number, RSTART?: number, RLENGTH?: number, awkArrays?: Record<string, Record<string, string>> }} ctx
 * @returns {{ ok: true, stdout: string } | { ok: false, stderr: string }}
 */
function awkRunPrintOnce(exprs, ctx) {
  const parts = [];
  for (const ex of exprs) {
    const v = awkEvalPrintExpr(ex, ctx);
    if (v === null) {
      return {
        ok: false,
        stderr: `awk: invalid print expression: ${ex.trim()}\n`
      };
    }
    parts.push(v);
  }
  return { ok: true, stdout: parts.join(' ') + '\n' };
}

/**
 * Run main-rule `print` on each line, or scan lines only when **exprs** is **null** (for **NR**).
 * @param {string} text
 * @param {string[] | null} exprs
 * @param {string} fieldSeparator
 * @param {number} nrStart - starting NR (1-based)
 * @param {Record<string, Record<string, string>>} [awkArraysStore] - shared across lines for **match(..., ..., arr)** and **arr[i]** reads
 * @returns {{ ok: true, stdout: string, nextNr: number, lastReadCtx: { $0: string, fields: string[], NR: number, NF: number } | null } | { ok: false, stderr: string }}
 */
function awkRunPrintProgram(text, exprs, fieldSeparator, nrStart, awkArraysStore) {
  const raw = String(text);
  const lines = awkSplitRecordLines(raw);
  const hadTrailingNl = raw.length > 0 && raw.endsWith('\n');
  const out = [];
  let nr = nrStart;
  let lastReadCtx = null;
  const arrStore = awkArraysStore === undefined ? Object.create(null) : awkArraysStore;
  for (const line of lines) {
    const fields = awkSplitFields(line, fieldSeparator);
    const ctx = {
      $0: line,
      fields,
      NR: nr,
      NF: fields.length,
      fieldSeparator,
      RSTART: 0,
      RLENGTH: -1,
      awkArrays: arrStore
    };
    lastReadCtx = ctx;
    if (exprs !== null && exprs !== undefined) {
      const parts = [];
      for (const ex of exprs) {
        const v = awkEvalPrintExpr(ex, ctx);
        if (v === null) {
          return {
            ok: false,
            stderr: `awk: invalid print expression: ${ex.trim()}\n`
          };
        }
        parts.push(v);
      }
      out.push(parts.join(' '));
    }
    nr++;
  }
  let stdout = out.join('\n');
  if (out.length > 0 && (hadTrailingNl || lines.length === 0)) {
    stdout += '\n';
  }
  return { ok: true, stdout, nextNr: nr, lastReadCtx };
}

export const AwkLib = {
  AWK_HELP,
  awkOptionError,
  parseAwkArgv,
  parseAwkFullProgram,
  parseAwkPrintProgram,
  awkBeginCtx,
  awkRunPrintOnce,
  awkRunPrintProgram,
  awkSplitFields,
  awkSplitCommaListTopLevel,
  awkSplitTopLevelCommas,
  awkParseNamedCall,
  awkEvalArithmeticExpr,
  awkStrToNum,
  awkFormatArithResult,
  awkEvalPrintExpr,
  awkParseArrayAccess,
  awkEvalSplitExpr,
  awkRebuild0FromFields,
  awkLiteralGsubAll,
  awkLiteralSubFirst,
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst
};
