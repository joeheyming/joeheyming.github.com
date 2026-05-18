import { awkSplitPrintArgs } from './awk-comma.js';

/**
 * Parse inner of `{ ... }` as `print EXPR,...` OR `printf FMT, EXPR,...` (B11).
 * @param {string} body
 * @returns {{ ok: true, kind: 'print', exprs: string[] } | { ok: true, kind: 'printf', exprs: string[] } | { ok: false, stderr: string }}
 */
function parseAwkPrintBlockBody(body) {
  const trimmed = String(body).trim();
  const pf = /^\s*printf\s*(.*)\s*$/s.exec(trimmed);
  if (pf) {
    const inner = pf[1].trim();
    if (inner === '') {
      return { ok: false, stderr: 'awk: printf requires at least a format string\n' };
    }
    const sp = awkSplitPrintArgs(inner);
    return { ok: true, kind: 'printf', exprs: sp.parts.length > 0 ? sp.parts : [inner] };
  }
  const m = /^\s*print\s*(.*)\s*$/s.exec(trimmed);
  if (!m) {
    return { ok: false, stderr: 'awk: jsh only supports {print ...} or {printf ...} blocks\n' };
  }
  const inner = m[1].trim();
  if (inner === '') {
    return { ok: true, kind: 'print', exprs: ['$0'] };
  }
  const sp = awkSplitPrintArgs(inner);
  if (sp.parts.length === 0) {
    return { ok: true, kind: 'print', exprs: ['$0'] };
  }
  return { ok: true, kind: 'print', exprs: sp.parts };
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
 * Parse optional BEGIN / main / END `{print|printf ...}` blocks (jsh subset).
 * Main rule may be `/PATTERN/ { action }` — body only runs when $0 matches.
 * @param {string} program
 * @returns {{ ok: true, beginExprs: string[] | null, beginKind?: string, mainExprs: string[] | null, mainKind?: string, mainCondition?: { type: 'regex', source: string, flags: string } | null, endExprs: string[] | null, endKind?: string } | { ok: false, stderr: string }}
 */
function parseAwkFullProgram(program) {
  let s = String(program).trim();
  let beginExprs = null;
  let beginKind = 'print';
  let mainExprs = null;
  let mainKind = 'print';
  let mainCondition = null;
  let endExprs = null;
  let endKind = 'print';

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
    beginKind = pb.kind;
    s = br.rest.trimStart();
  }

  // Main rule: optional `/PATTERN/` condition before the `{action}` block.
  if (s.startsWith('/')) {
    // Parse a slash-delimited regex condition; backslash-escape \/ inside.
    let i = 1;
    let pat = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        const n = s[i + 1];
        if (n === '/') {
          pat += '/';
          i += 2;
          continue;
        }
        pat += '\\' + n;
        i += 2;
        continue;
      }
      if (c === '/') break;
      pat += c;
      i++;
    }
    if (s[i] !== '/') {
      return { ok: false, stderr: 'awk: unterminated /regex/ condition\n' };
    }
    s = s.slice(i + 1).trimStart();
    mainCondition = { type: 'regex', source: pat, flags: '' };
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
    mainKind = pb.kind;
    s = br.rest.trimStart();
  } else if (mainCondition !== null) {
    // `/pat/` with no action prints the matching line.
    mainExprs = ['$0'];
    mainKind = 'print';
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
    endKind = pb.kind;
    s = br.rest.trimStart();
  }

  if (s.length > 0) {
    return { ok: false, stderr: 'awk: jsh: unexpected trailing program text\n' };
  }

  if (beginExprs === null && mainExprs === null && endExprs === null) {
    return {
      ok: false,
      stderr: 'awk: jsh only supports BEGIN/main/END {print|printf ...} (with optional /regex/ on main)\n'
    };
  }

  return {
    ok: true,
    beginExprs,
    beginKind,
    mainExprs,
    mainKind,
    mainCondition,
    endExprs,
    endKind
  };
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

/** Get parseAwkPrintBlockBody for external callers (tests). */
export { parseAwkPrintBlockBody };

export { parseAwkFullProgram, parseAwkPrintProgram };
