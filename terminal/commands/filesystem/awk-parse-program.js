import { awkSplitPrintArgs } from './awk-comma.js';

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

export { parseAwkFullProgram, parseAwkPrintProgram };
